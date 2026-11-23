import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import multer from "multer";
import { notebookTriggersService } from "../services/notebook-triggers.service.js";
import { notebookFilesService } from "../services/notebook-files.service.js";
import { maxUploadBytes, hookRateLimitWindowMs, hookRateLimitMax } from "../config.js";
import {
  notebookExecutionService,
  NotebookNotDeployedError,
  OwnerInactiveError,
  NotebookNotFoundError,
  TooManyRunsError,
} from "../services/notebook-execution.service.js";
import { AttemptLimiter } from "../core/attempt-limiter.js";
import { NotebookCompileError } from "../core/notebook-compiler.js";
import { ContractError } from "../core/notebook-contract.js";
import { secretsService } from "../services/secrets.service.js";
import { notebookAccessService } from "../services/notebook-access.service.js";
import { notebooksService } from "../services/notebooks.service.js";
import { audit } from "../services/audit.service.js";
import { setActor } from "../core/request-context.js";
import type { RunEventSink } from "../core/run-emitter.js";
import { logger } from "../core/logger.js";
import { internalError } from "../core/http-errors.js";
import { genericRunError } from "../core/run-projection.js";

/** Long enough for a real API call, short enough that a caller is not left hanging. */
const DEFAULT_WAIT_MS = 30_000;
const MAX_WAIT_MS = 120_000;

export async function isSecretAuthenticatedWebhook(slug: string, secretHeader?: string): Promise<boolean> {
  if (!slug) return false;
  const trigger = await notebookTriggersService.findEnabledWebhook(slug);
  if (!trigger || !trigger.secret_key) return false;

  // The owner's: a webhook is guarded by a secret of the notebook it starts, and that
  // notebook runs with its owner's.
  const expected = await secretsService.getValueByKey(
    await notebookAccessService.ownerOf(trigger.notebook_id),
    trigger.secret_key
  );
  // A missing secret is a misconfiguration, not a bad request — the webhook
  // can never succeed until it is fixed. The caller still gets the same 401
  // so nothing about the configuration leaks, but the operator gets told.
  if (!expected) {
    // Named by trigger and notebook: the slug is the webhook's credential and stays out.
    logger.error(
      "A webhook requires a secret that does not exist in the secrets store. It will reject every request until the secret is created or the trigger is changed.",
      {
        event: "webhook.secret_missing",
        trigger_id: trigger.id,
        notebook_id: trigger.notebook_id,
        secret_name: trigger.secret_key,
      }
    );
    return false;
  }


  if (secretHeader === undefined) return false;
  // Both sides are hashed first so the two buffers are the same length, which
  // `timingSafeEqual` demands, and so the time taken does not depend on how many leading
  // characters of the guess were right (or on how long the real secret is).
  const sha = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(sha(secretHeader), sha(expected));
}

const hookAttempts = new AttemptLimiter(hookRateLimitMax, hookRateLimitWindowMs);

/**
 * How far past the limit a client may keep asking to have a secret checked, as a multiple of
 * the limit. Verifying a secret costs database queries, so a flood of requests that merely
 * *claim* to carry one is cut off by the count alone once it is this far over.
 */
const HOOK_CHECK_CEILING_FACTOR = 20;

/**
 * Limits the webhooks that carry no valid secret, per client address.
 *
 * The order is the point. This used to ask the database whether the request was
 * authenticated *before* counting it, so a flood of unauthenticated requests cost three
 * queries each and was counted only after they had been paid for. Now the request is counted
 * first, with no I/O at all:
 *
 *  - Within the limit it simply goes through. Nothing is looked up, because nothing has
 *    to be decided yet.
 *  - Past it, a request with no `X-Webhook-Secret` is refused outright: it cannot be
 *    authenticated, so there is nothing to look up.
 *  - Past it with a secret, the database is asked, and a request that proves itself is
 *    given its place in the count back: authenticated callers are never limited, as before.
 *    A caller that is only claiming to carry one is refused once it is far enough over
 *    ({@link HOOK_CHECK_CEILING_FACTOR}) that checking it would be the attack.
 */
export const hookLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const key = req.ip ?? "unknown";
  const made = hookAttempts.count(key);
  const refuse = () => {
    // Which hook is not known yet (and its slug is a credential, so it is never recorded):
    // the address is what identifies the caller, and the audit service rations a burst.
    void audit.record({
      action: "webhook.received",
      outcome: "denied",
      target: { type: "webhook" },
      meta: { reason: "rate_limited" },
    });
    res
      .status(429)
      .set("Retry-After", String(hookAttempts.retryAfterSeconds(key)))
      .json({ error: "Too many unauthenticated webhook requests. Please try again later." });
  };

  if (made <= hookRateLimitMax()) return next();

  const header = typeof req.headers["x-webhook-secret"] === "string" ? req.headers["x-webhook-secret"] : undefined;
  if (header === undefined || made > hookRateLimitMax() * HOOK_CHECK_CEILING_FACTOR) return refuse();

  try {
    if (await isSecretAuthenticatedWebhook(String(req.params.slug ?? ""), header)) {
      hookAttempts.refund(key);
      return next();
    }
  } catch (err: unknown) {
    return next(err);
  }
  refuse();
};


/**
 * Files arriving at a webhook.
 *
 * In memory and capped, because this is the one door here that opens onto the internet.
 * Where the bytes land is decided after the hook has been identified — a request cannot
 * name a folder, and cannot even cause a folder to exist until it has been let in.
 */
const uploads = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes(), files: 8 },
});

/** What multer leaves on the request. Narrower than multer's own type, on purpose. */
interface MultipartFile {
  fieldname: string;
  originalname: string;
  buffer: Buffer;
}

function multipartFields(req: Request, res: Response, next: NextFunction) {
  if (!String(req.headers["content-type"] ?? "").includes("multipart/form-data")) return next();

  uploads.any()(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `A file is larger than the ${Math.round(maxUploadBytes() / (1024 * 1024))} MB limit.`,
      });
    }
    res.status(400).json({ error: (err as Error).message });
  });
}

/** Headers worth passing to a notebook; the rest are noise or sensitive. */
const FORWARDED_HEADERS = ["content-type", "user-agent", "x-request-id"];

function forwardedHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

/**
 * Public webhook entry points.
 *
 * Mounted outside `authMiddleware`: the slug *is* the credential, so it is an
 * unguessable id rather than a name. A trigger may additionally name a secret whose
 * value must arrive as `X-Webhook-Secret`.
 *
 * What a webhook answers is decided by the notebook's own contract:
 *
 *   - **Declares outputs** → the request waits and hands them back. A caller asking a
 *     question wants the answer, and "here is a run id, go and poll it" is not an answer.
 *   - **Declares none** → 202 with a run id, as before. Nothing useful can be returned,
 *     so waiting would only make the caller slower.
 *
 * This is why the contract is worth writing down: it is the difference between a hook
 * that answers you and one that merely acknowledges you.
 */
export function createHooksRouter(publishRunEvent: RunEventSink): Router {
  const router = Router();

  router.post("/:slug", hookLimiter, multipartFields, async (req: Request, res: Response) => {
    // Set once the trigger is known, so a failure further down can still say whose it was.
    let received: { target: Awaited<ReturnType<typeof notebooksService.auditTarget>>; triggerId: string } | null = null;
    try {
      const trigger = await notebookTriggersService.findEnabledWebhook(String(req.params.slug));
      // Same answer for "no such hook" and "disabled hook", so probing tells nothing.
      if (!trigger) {
        await audit.record({
          action: "webhook.received",
          outcome: "failure",
          target: { type: "webhook" },
          meta: { reason: "unknown_webhook" },
        });
        return res.status(404).json({ error: "Unknown webhook" });
      }

      // Named by the trigger's row, never by the slug, which is the credential. From here on
      // the run this starts, and every log line and audit event, carries it.
      setActor({ type: "webhook", triggerId: trigger.id, notebookId: trigger.notebook_id });
      const target = await notebooksService.auditTarget(trigger.notebook_id);
      received = { target, triggerId: trigger.id };

      const attached = (req as Request & { files?: MultipartFile[] }).files ?? [];

      /**
       * A hook that accepts files must have a secret. Agreed in v2 and enforced here
       * rather than at configuration time, because a trigger can lose its secret after it
       * was made — and the difference this guards is real: an open hook that runs a
       * notebook costs somebody a few seconds of CPU, while an open hook that *stores what
       * you send it* is free disk space on a stranger's server.
       */
      if (attached.length > 0 && !trigger.secret_key) {
        await audit.record({
          action: "webhook.received",
          outcome: "denied",
          target,
          meta: { triggerId: trigger.id, reason: "files_without_secret" },
        });
        return res.status(401).json({
          error:
            "This webhook accepts no files because it has no secret. Give the trigger a " +
            "`secretKey` and send it as X-Webhook-Secret.",
        });
      }

      if (trigger.secret_key) {
        const secretHeader = typeof req.headers["x-webhook-secret"] === "string" ? req.headers["x-webhook-secret"] : undefined;
        const valid = await isSecretAuthenticatedWebhook(trigger.slug || "", secretHeader);
        if (!valid) {
          await audit.record({
            action: "webhook.received",
            outcome: "denied",
            target,
            meta: { triggerId: trigger.id, reason: "bad_secret" },
          });
          return res.status(401).json({ error: "Invalid webhook secret" });
        }
      }



      // Stored before the run starts, and named after the form field they arrived in — so
      // a notebook declaring `photo` as a `file` input is called with the file somebody
      // put in the `photo` field, and the contract judges it like any other argument.
      const fields: Record<string, unknown> = {};
      for (const file of attached) {
        fields[file.fieldname] = notebookFilesService.keepUpload(
          trigger.notebook_id,
          file.originalname,
          file.buffer,
          "hook"
        );
      }

      const body = typeof req.body === "object" && req.body !== null ? req.body : {};
      const args = attached.length > 0 ? { ...body, ...fields } : body;

      const started = await notebookExecutionService.start(trigger.notebook_id, publishRunEvent, {
        triggerSource: "webhook",
        // A notebook that declares inputs is called by this request, not merely
        // triggered by it: the body binds to the contract and a mismatch is a 400.
        args,
        input: {
          trigger: {
            kind: "webhook",
            slug: trigger.slug,
            body: req.body ?? null,
            query: req.query ?? {},
            headers: forwardedHeaders(req),
            receivedAt: new Date().toISOString(),
          },
        },
      });

      const { runId, declaredOutputs, completed } = started;
      await audit.record({
        action: "webhook.received",
        target,
        meta: { triggerId: trigger.id, runId, files: attached.length },
      });
      received = null;

      if (declaredOutputs.length === 0) {
        return res.status(202).json({ status: "started", runId });
      }

      const requested = Number(req.query.timeoutMs);
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(requested, 1_000), MAX_WAIT_MS)
        : DEFAULT_WAIT_MS;

      let timer: NodeJS.Timeout | undefined;
      const timedOut = Symbol("timeout");
      const outcome = await Promise.race([
        completed,
        new Promise<typeof timedOut>((resolve) => {
          timer = setTimeout(() => resolve(timedOut), limit);
        }),
      ]);
      if (timer) clearTimeout(timer);

      // A run that outlives the caller's patience keeps going; the id is how they find
      // out how it ended.
      if (outcome === timedOut) {
        return res.status(202).json({
          status: "started",
          runId,
          note: `Still running after ${limit / 1000}s.`,
        });
      }

      if (outcome.status === "failed") {
        // The caller of a webhook is whoever holds the URL, not the notebook's author: the
        // text a cell raised (often a request URL or a response body) stays in the run, where
        // the owner can read it by this id.
        return res.status(500).json({
          status: "failed",
          runId,
          error: genericRunError(runId),
        });
      }

      res.status(200).json({ status: "success", runId, outputs: outcome.outputs });
    } catch (err: unknown) {
      // The hook was valid and the caller proved it, but the run could not start.
      if (received) {
        await audit.record({
          action: "webhook.received",
          outcome: "failure",
          target: received.target,
          meta: { triggerId: received.triggerId, reason: err instanceof Error ? err.name : "error" },
        });
      }
      if (err instanceof TooManyRunsError) {
        return res.status(429).json({ error: err.message });
      }
      if (err instanceof NotebookNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      // The hook exists but its notebook was never deployed. Told plainly to the
      // caller *and* the log, because from outside this looks like the hook is broken.
      if (err instanceof NotebookNotDeployedError) {
        logger.error("A webhook fired for a notebook that was never deployed.", { event: "webhook.not_deployed", err });
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof OwnerInactiveError) {
        logger.error("A webhook fired for a notebook whose owner is deactivated.", { event: "webhook.owner_inactive", err });
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof NotebookCompileError) {
        return res.status(400).json({ error: err.message, issues: err.issues });
      }
      if (err instanceof ContractError) {
        return res.status(400).json({ error: err.message, issues: err.issues });
      }
      internalError(res, err, "webhook.request_failed");
    }
  });

  return router;
}

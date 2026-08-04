import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { notebookTriggersService } from "../services/notebook-triggers.service.js";
import { notebookFilesService } from "../services/notebook-files.service.js";
import { maxUploadBytes } from "../config.js";
import {
  notebookExecutionService,
  NotebookNotDeployedError,
  NotebookNotFoundError,
  TooManyRunsError,
} from "../services/notebook-execution.service.js";
import { NotebookCompileError } from "../core/notebook-compiler.js";
import { ContractError } from "../core/notebook-contract.js";
import { secretsService } from "../services/secrets.service.js";
import type { RunEventSink } from "../core/run-emitter.js";

/** Long enough for a real API call, short enough that a caller is not left hanging. */
const DEFAULT_WAIT_MS = 30_000;
const MAX_WAIT_MS = 120_000;

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

  router.post("/:slug", multipartFields, async (req: Request, res: Response) => {
    try {
      const trigger = await notebookTriggersService.findEnabledWebhook(String(req.params.slug));
      // Same answer for "no such hook" and "disabled hook", so probing tells nothing.
      if (!trigger) return res.status(404).json({ error: "Unknown webhook" });

      const attached = (req as Request & { files?: MultipartFile[] }).files ?? [];

      /**
       * A hook that accepts files must have a secret. Agreed in v2 and enforced here
       * rather than at configuration time, because a trigger can lose its secret after it
       * was made — and the difference this guards is real: an open hook that runs a
       * notebook costs somebody a few seconds of CPU, while an open hook that *stores what
       * you send it* is free disk space on a stranger's server.
       */
      if (attached.length > 0 && !trigger.secret_key) {
        return res.status(401).json({
          error:
            "This webhook accepts no files because it has no secret. Give the trigger a " +
            "`secretKey` and send it as X-Webhook-Secret.",
        });
      }

      if (trigger.secret_key) {
        const expected = await secretsService.getValueByKey(trigger.secret_key);

        // A missing secret is a misconfiguration, not a bad request — the webhook
        // can never succeed until it is fixed. The caller still gets the same 401
        // so nothing about the configuration leaks, but the operator gets told.
        if (!expected) {
          console.error(
            `Webhook "${trigger.slug}" requires secret "${trigger.secret_key}", ` +
              `which does not exist in the secrets store. This webhook will reject every ` +
              `request until the secret is created or the trigger is changed.`
          );
        }

        if (!expected || req.headers["x-webhook-secret"] !== expected) {
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
        return res.status(500).json({
          status: "failed",
          runId,
          error: outcome.errors[0] ?? "Run failed",
        });
      }

      res.status(200).json({ status: "success", runId, outputs: outcome.outputs });
    } catch (err: unknown) {
      if (err instanceof TooManyRunsError) {
        return res.status(429).json({ error: err.message });
      }
      if (err instanceof NotebookNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      // The hook exists but its notebook was never deployed. Told plainly to the
      // caller *and* the log, because from outside this looks like the hook is broken.
      if (err instanceof NotebookNotDeployedError) {
        console.error(`Webhook "${String(req.params.slug)}": ${err.message}`);
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof NotebookCompileError) {
        return res.status(400).json({ error: err.message, issues: err.issues });
      }
      if (err instanceof ContractError) {
        return res.status(400).json({ error: err.message, issues: err.issues });
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

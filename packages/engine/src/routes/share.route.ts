import { Router, type Request, type Response } from "express";
import multer from "multer";
import { notebookSharesService, type ShareRow } from "../services/notebook-shares.service.js";
import { notebookFilesService } from "../services/notebook-files.service.js";
import {
  maxUploadBytes,
  loginRateLimitWindowMs,
  sharePasswordIpMax,
  sharePasswordLinkMax,
} from "../config.js";
import { AttemptLimiter } from "../core/attempt-limiter.js";
import { notebooksService } from "../services/notebooks.service.js";
import {
  notebookExecutionService,
  NotebookNotDeployedError,
  OwnerInactiveError,
  NotebookNotFoundError,
  TooManyRunsError,
} from "../services/notebook-execution.service.js";
import { ContractError } from "../core/notebook-contract.js";
import { NotebookCompileError } from "../core/notebook-compiler.js";
import { outputSpecs } from "../core/notebook-outputs.js";
import { normaliseTags } from "@zaa-tool/shared";
import { setActor } from "../core/request-context.js";
import { actionSpecs } from "../core/notebook-actions.js";
import type { RunEventSink } from "../core/run-emitter.js";
import type { NotebookJson, NotebookPage } from "@zaa-tool/shared";

/**
 * Pages handed to people who have no account here.
 *
 * Mounted outside `authMiddleware`, like `/hooks`: the token in the URL is the
 * credential. Everything served is derived from the *deployed* version, and nothing here
 * can read or write a notebook — the only verbs are "describe this page" and "run it".
 *
 * A shared page runs somebody else's compute on your machine, so it carries its own
 * bound on top of the engine's run gate. The gate stops the server falling over; this
 * stops one link being turned into a free worker.
 */

/** Runs allowed per link per window. Generous for a person, useless as a compute farm. */
const RUNS_PER_WINDOW = 30;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * In memory on purpose.
 *
 * Losing the counter on restart is the right failure: the durable record of use is
 * `run_count` on the row, and a limiter that survives a restart would need a table whose
 * only job is to be written on every request.
 */
const recentRuns = new Map<string, number[]>();

/**
 * Password guesses, counted per client address and per link.
 *
 * A wrong password is a bcrypt comparison, and bcrypt runs on a thread pool of four shared
 * with everything else in the process, so unbounded guessing is both a way into a protected
 * page and a way to starve the engine. Both counters are taken *before* the comparison, in
 * one synchronous step, so a burst of parallel guesses cannot all slip in ahead of the
 * count; a correct password gives its places back.
 */
const guessesByAddress = new AttemptLimiter(sharePasswordIpMax, loginRateLimitWindowMs);
const guessesByLink = new AttemptLimiter(sharePasswordLinkMax, loginRateLimitWindowMs);

/** One file, in memory, size-limited. Where it lands is not this route's decision. */
const attachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes(), files: 1 },
});

function withinLimit(shareId: string): boolean {
  const now = Date.now();
  const times = (recentRuns.get(shareId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (times.length >= RUNS_PER_WINDOW) {
    recentRuns.set(shareId, times);
    return false;
  }
  times.push(now);
  recentRuns.set(shareId, times);
  return true;
}

/** A notebook's own first sentence, which is the best description anyone will write. */
function firstNoteOf(document: NotebookJson): string {
  for (const step of document.steps ?? []) {
    if (step.kind === "cell" && step.note?.trim()) {
      const line = step.note
        .split("\n")
        .map((text) => text.replace(/^#+\s*/, "").trim())
        .find((text) => text.length > 0);
      if (line) return line;
    }
  }
  return "";
}

/** Every note, in order — what a notebook with no contract has instead of a page. */
function notesOf(document: NotebookJson): string[] {
  const notes: string[] = [];
  for (const step of document.steps ?? []) {
    if (step.kind === "cell" && step.note?.trim()) notes.push(step.note.trim());
  }
  return notes;
}

function pageOf(id: string, document: NotebookJson): NotebookPage {
  const outputs = outputSpecs(document.outputs);
  const hasContract = (document.inputs?.length ?? 0) > 0 || outputs.length > 0;
  return {
    id,
    name: document.name,
    description: firstNoteOf(document),
    // Carried so a shared page describes itself the same way the Apps list does; nobody
    // browsing a single link filters on them.
    tags: normaliseTags(document.tags ?? []),
    // A written notebook can be shared as what it is: the thing somebody wrote.
    notes: hasContract ? [] : notesOf(document),
    inputs: document.inputs ?? [],
    outputs,
    layout: (document.layout ?? []).filter((item) =>
      outputs.some((output) => output.name === item.i)
    ),
    // A link grants one notebook, not a path to the others. `run` actions are dropped
    // here rather than hidden in the browser, so the target's name never leaves the
    // server — otherwise a share link would publish what else exists in the workspace.
    actions: actionSpecs(document.actions).filter((action) => action.do !== "run"),
  };
}

export function createShareRouter(publishRunEvent: RunEventSink): Router {
  const router = Router();

  /**
   * Resolves the link and checks the password.
   *
   * The same 404 for unknown and revoked, so probing a token tells nothing. A wrong or
   * missing password is 401 with `needsPassword`, which is not a leak: whoever holds the
   * link already knows a page is there.
   */
  const open = async (
    req: Request,
    res: Response
  ): Promise<{ share: ShareRow; document: NotebookJson } | null> => {
    const share = await notebookSharesService.resolve(String(req.params.token));
    if (!share) {
      res.status(404).json({ error: "This link does not work." });
      return null;
    }
    // Named by the share row, never by the token in the URL (which is the credential). From
    // here on the run this may start, and every log line and audit event, carries it.
    setActor({ type: "share", shareId: share.id, notebookId: share.notebook_id });

    const password = req.header("x-share-password") ?? undefined;
    // Only an actual guess is counted: opening the page to be asked for the password is not
    // one, and a person who reloads should not use their attempts up doing it.
    const guessing = Boolean(share.password_hash) && Boolean(password);
    const addressKey = req.ip ?? "unknown";
    if (guessing) {
      const byAddress = guessesByAddress.reserve(addressKey);
      const byLink = guessesByLink.reserve(share.id);
      if (!byAddress || !byLink) {
        await notebookSharesService.recordPasswordFailure(share, "denied", "rate_limited");
        // Over the limit still counts, so persistence does not buy a fresh window; what is
        // refused here never reaches bcrypt.
        res
          .status(429)
          .set("Retry-After", String(guessesByAddress.retryAfterSeconds(addressKey)))
          .json({ error: "Too many password attempts. Try again later." });
        return null;
      }
    }
    if (!(await notebookSharesService.checkPassword(share, password))) {
      // Asking for the password is not a failure; getting it wrong is. The guess is never kept.
      if (guessing) await notebookSharesService.recordPasswordFailure(share, "failure", "wrong_password");
      res.status(401).json({ error: "This page needs a password.", needsPassword: true });
      return null;
    }
    if (guessing) {
      guessesByAddress.refund(addressKey);
      guessesByLink.refund(share.id);
    }

    const document = await notebooksService.getDeployedDocument(share.notebook_id);
    if (!document) {
      // Undeployed since the link was made. Deliberately distinguishable from a dead
      // link: the owner took it out of production, and saying so is the honest answer.
      res.status(409).json({ error: "This page is not in production at the moment." });
      return null;
    }

    return { share, document };
  };

  router.get("/:token", async (req: Request, res: Response) => {
    try {
      const opened = await open(req, res);
      if (!opened) return;
      res.json(pageOf(opened.share.notebook_id, opened.document));
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * A file attached by someone with no account here.
   *
   * Held to the same bound as a run: a link that can be turned into free disk is worse
   * than one that can be turned into free compute, so it costs a slot from the same
   * counter rather than having a second one nobody would think to look at.
   */
  router.post("/:token/uploads", attachment.single("file"), async (req: Request, res: Response) => {
    try {
      const opened = await open(req, res);
      if (!opened) return;

      if (!withinLimit(opened.share.id)) {
        return res.status(429).json({ error: "This link has been used too many times today." });
      }

      const file = (req as Request & { file?: { originalname: string; buffer: Buffer } }).file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      res.json(
        notebookFilesService.keepUpload(
          opened.share.notebook_id,
          file.originalname,
          file.buffer,
          "page"
        )
      );
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/:token/run", async (req: Request, res: Response) => {
    try {
      const opened = await open(req, res);
      if (!opened) return;

      if (!withinLimit(opened.share.id)) {
        return res.status(429).json({
          error: `This link has run ${RUNS_PER_WINDOW} times in the last hour. Try again later.`,
        });
      }

      const started = await notebookExecutionService.start(
        opened.share.notebook_id,
        publishRunEvent,
        { args: req.body?.args, triggerSource: "page" }
      );

      void started.completed.catch(() => {});
      await notebookSharesService.recordRun(opened.share.id);

      res.json({ status: "started", runId: started.runId });
    } catch (err: unknown) {
      if (err instanceof ContractError || err instanceof NotebookCompileError) {
        return res.status(400).json({ error: err.message, issues: err.issues });
      }
      if (err instanceof TooManyRunsError) {
        return res.status(429).json({ error: err.message });
      }
      if (err instanceof NotebookNotDeployedError || err instanceof OwnerInactiveError) {
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof NotebookNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

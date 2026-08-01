import { Request, Response } from "express";
import { notebooksService } from "../services/notebooks.service.js";
import { buildNotebookMap } from "../core/notebook-map.js";
import { notifyCatalogChanged } from "../mcp/notebook-catalog.js";
import { notebookRunsService } from "../services/notebook-runs.service.js";
import {
  notebookExecutionService,
  NotebookNotFoundError,
  CellNotFoundError,
  NotebookNotDeployedError,
  TooManyRunsError,
} from "../services/notebook-execution.service.js";
import { NotebookCompileError } from "../core/notebook-compiler.js";
import { ContractError } from "../core/notebook-contract.js";
import type { RunEventSink } from "../core/run-emitter.js";
import type { NotebookJson, NotebookPage } from "@zaa-tool/shared";

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

function respondWithError(res: Response, err: unknown) {
  if (err instanceof NotebookNotFoundError || err instanceof CellNotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  // The arguments were wrong, not the notebook — the caller can fix this one.
  if (err instanceof ContractError) {
    return res.status(400).json({ error: err.message, issues: err.issues });
  }
  if (err instanceof NotebookCompileError) {
    return res.status(400).json({ error: err.message, issues: err.issues });
  }
  if (err instanceof TooManyRunsError) {
    return res.status(429).json({ error: err.message });
  }
  // Not a bad request and not a missing one: the notebook exists, but nobody has said
  // this version may run unattended.
  if (err instanceof NotebookNotDeployedError) {
    return res.status(409).json({ error: err.message });
  }
  return res.status(500).json({ error: (err as Error).message });
}

export class NotebooksController {
  constructor(private readonly publishRunEvent: RunEventSink) {}

  list = async (_req: Request, res: Response) => {
    try {
      res.json(await notebooksService.getSummary());
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** The system map. Computed on request — there is nothing stored to go stale. */
  map = async (_req: Request, res: Response) => {
    try {
      res.json(buildNotebookMap(await notebooksService.getAllDocuments()));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /**
   * Every deployed notebook that has a contract, as a page.
   *
   * The same rule as the agent catalogue: no contract, nothing to render. A notebook
   * that takes nothing and returns nothing is not a page, it is a button — and there is
   * already a Run button in the editor.
   */
  pages = async (_req: Request, res: Response) => {
    try {
      const pages: NotebookPage[] = [];

      for (const summary of await notebooksService.getSummary()) {
        const document = await notebooksService.getDeployedDocument(summary.id);
        if (!document) continue;
        if ((document.inputs?.length ?? 0) === 0 && (document.outputs?.length ?? 0) === 0) continue;

        pages.push({
          id: summary.id,
          name: document.name,
          description: firstNoteOf(document),
          inputs: document.inputs ?? [],
          outputs: document.outputs ?? [],
        });
      }

      res.json(pages);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  getById = async (req: Request, res: Response) => {
    try {
      const record = await notebooksService.getById(String(req.params.id));
      if (!record) return res.status(404).json({ error: "Notebook not found" });
      res.json(notebooksService.parseDocument(record));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  save = async (req: Request, res: Response) => {
    try {
      if (!req.body || !Array.isArray(req.body.steps)) {
        return res.status(400).json({ error: "Invalid notebook: missing steps" });
      }
      const user = (req as Request & { user?: { username?: string } }).user;
      res.json(await notebooksService.save(req.body, user?.username ?? "unknown"));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** What production is running, and whether the draft has moved on since. */
  deployState = async (req: Request, res: Response) => {
    try {
      const state = await notebooksService.getDeployState(String(req.params.id));
      if (!state) return res.status(404).json({ error: "Notebook not found" });
      res.json(state);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** The version production is running, so the editor can show what has changed. */
  deployedDocument = async (req: Request, res: Response) => {
    try {
      const document = await notebooksService.getDeployedDocument(String(req.params.id));
      if (!document) return res.status(404).json({ error: "Nothing deployed" });
      res.json(document);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  deploy = async (req: Request, res: Response) => {
    try {
      // Named on the version, because "who decided this may run unattended" is the
      // question a deploy record exists to answer.
      const user = (req as Request & { user?: { username?: string } }).user;
      const result = await notebooksService.deploy(
        String(req.params.id),
        user?.username ?? "unknown"
      );
      if (!result) return res.status(404).json({ error: "Notebook not found" });

      // Deploying may have added or changed a tool, and an agent connected an hour ago
      // should not have to reconnect to find out.
      notifyCatalogChanged();
      res.json(result);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const result = await notebooksService.delete(String(req.params.id));
      notifyCatalogChanged();
      res.json(result);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  listRuns = async (req: Request, res: Response) => {
    try {
      res.json(await notebookRunsService.listByNotebook(String(req.params.id)));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  clearRuns = async (req: Request, res: Response) => {
    try {
      res.json(await notebookRunsService.deleteByNotebook(String(req.params.id)));
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  /** `latest` resolves the most recent run, which is what the editor restores on open. */
  getRun = async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const run =
        runId === "latest"
          ? await notebookRunsService.getLatestForNotebook(String(req.params.id))
          : await notebookRunsService.getById(runId);

      if (!run) return res.status(404).json({ error: "Run not found" });
      res.json(run);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  run = async (req: Request, res: Response) => {
    try {
      // The editor runs the draft and follows along over the socket. A page is someone
      // *using* the notebook, so it runs the deployed version and waits for the answer —
      // there is nothing for a page to show while it polls.
      const isPage = req.body?.mode === "deployed";

      const started = await notebookExecutionService.start(
        String(req.params.id),
        this.publishRunEvent,
        {
          input: req.body?.input,
          args: req.body?.args,
          cellId: req.body?.cellId,
          ...(isPage ? { triggerSource: "page" as const } : {}),
        }
      );

      if (!isPage) {
        return res.status(200).json({ status: "started", runId: started.runId });
      }

      const outcome = await started.completed;
      if (outcome.status === "failed") {
        return res.status(200).json({
          status: "failed",
          runId: started.runId,
          error: outcome.errors[0] ?? "Run failed",
        });
      }

      res.status(200).json({
        status: "success",
        runId: started.runId,
        ms: outcome.ms,
        outputs: outcome.outputs,
      });
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };
}

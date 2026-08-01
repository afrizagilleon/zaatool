import { Request, Response } from "express";
import { notebooksService } from "../services/notebooks.service.js";
import { buildNotebookMap } from "../core/notebook-map.js";
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
      res.json(result);
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      res.json(await notebooksService.delete(String(req.params.id)));
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
      const { runId } = await notebookExecutionService.start(
        String(req.params.id),
        this.publishRunEvent,
        { input: req.body?.input, args: req.body?.args, cellId: req.body?.cellId }
      );
      res.status(200).json({ status: "started", runId });
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };
}

import { Request, Response } from "express";
import { notebooksService } from "../services/notebooks.service.js";
import {
  notebookExecutionService,
  NotebookNotFoundError,
} from "../services/notebook-execution.service.js";
import { NotebookCompileError } from "../core/notebook-compiler.js";
import type { RunEventSink } from "../core/run-emitter.js";

function respondWithError(res: Response, err: unknown) {
  if (err instanceof NotebookNotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  if (err instanceof NotebookCompileError) {
    return res.status(400).json({ error: err.message, issues: err.issues });
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
      res.json(await notebooksService.save(req.body));
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

  run = async (req: Request, res: Response) => {
    try {
      const { runId } = await notebookExecutionService.start(
        String(req.params.id),
        this.publishRunEvent,
        req.body?.input
      );
      res.status(200).json({ status: "started", runId });
    } catch (err: unknown) {
      respondWithError(res, err);
    }
  };
}

import { randomUUID } from "node:crypto";
import { compileNotebook } from "../core/notebook-compiler.js";
import { runNotebook } from "../core/notebook-runner.js";
import { createRunEmitter, type RunEventSink } from "../core/run-emitter.js";
import { notebooksService } from "./notebooks.service.js";
import { secretsService } from "./secrets.service.js";

export class NotebookNotFoundError extends Error {
  constructor(id: string) {
    super(`Notebook "${id}" not found`);
    this.name = "NotebookNotFoundError";
  }
}

/**
 * Starts notebook runs.
 *
 * Compiling and secret resolution happen before the run id is handed back, so a
 * malformed notebook fails the request outright instead of starting a run that
 * dies immediately. Execution itself is detached — progress arrives as events.
 */
export class NotebookExecutionService {
  async start(
    notebookId: string,
    publish: RunEventSink,
    input?: Record<string, unknown>
  ): Promise<{ runId: string }> {
    const record = await notebooksService.getById(notebookId);
    if (!record) throw new NotebookNotFoundError(notebookId);

    const plan = compileNotebook(notebooksService.parseDocument(record));
    const secrets = await secretsService.getByKeys(plan.secrets);

    const runId = randomUUID();
    const ee = createRunEmitter({ runId, flowId: notebookId }, publish);

    // Detached: runNotebook reports its own outcome through terminal events and
    // never rejects for a cell failure, so there is nothing to catch here.
    void runNotebook(plan, { ee, secrets, input });

    return { runId };
  }
}

export const notebookExecutionService = new NotebookExecutionService();

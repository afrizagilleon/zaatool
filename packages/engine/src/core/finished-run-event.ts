import type { NotebookRunDetail, RunEvent } from "@zaa-tool/shared";

/**
 * The terminal event a finished run would have ended its stream with, rebuilt from its
 * history row. The event hub keeps a run's events only briefly; a client that follows a run
 * after that would otherwise wait forever for an ending that was already sent and dropped.
 *
 * Null while the run is still going, because then there is no ending to report yet.
 */
export function finishedRunEvent(
  run: Pick<NotebookRunDetail, "id" | "notebook_id" | "status" | "error" | "started_at" | "finished_at"> | null
): RunEvent | null {
  if (!run || run.status === "running") return null;

  const started = run.started_at ? new Date(run.started_at).getTime() : NaN;
  const finished = run.finished_at ? new Date(run.finished_at).getTime() : NaN;
  const ms = Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : 0;
  const base = { runId: run.id, notebookId: run.notebook_id, ms };

  if (run.status === "success") return { type: "run:done", status: "success", ...base };
  return { type: "run:error", error: run.error ?? "Run failed", ...base };
}

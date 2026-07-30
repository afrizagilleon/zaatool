/**
 * A recorded notebook run.
 *
 * Outputs live here rather than in the notebook document. That split is what stops
 * a saved notebook from showing results of a session that no longer exists, and it
 * is what makes a failed 3am cron inspectable at all.
 */

export type NotebookRunStatus = "running" | "success" | "failed";

export type NotebookRunTrigger = "manual" | "cell" | "cron" | "webhook";

export interface CellLogEntry {
  level: string;
  msg: string;
}

export interface RecordedCellResult {
  /**
   * The code that actually ran. Stored so a restored run can be compared with the
   * cell's current code — without it, reopening a notebook would show outputs with
   * no way to tell whether they still match.
   */
  source?: string;
  output?: Record<string, unknown>;
  written?: string[];
  logs?: CellLogEntry[];
  error?: string;
  ms?: number;
}

export interface NotebookRunSummary {
  id: string;
  notebook_id: string;
  status: NotebookRunStatus;
  trigger_source: NotebookRunTrigger;
  /** Set when only one cell was run. */
  cell_id: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface NotebookRunDetail extends NotebookRunSummary {
  cell_results: Record<string, RecordedCellResult>;
}

/**
 * A recorded notebook run.
 *
 * Outputs live here rather than in the notebook document. That split is what stops
 * a saved notebook from showing results of a session that no longer exists, and it
 * is what makes a failed 3am cron inspectable at all.
 */

export type NotebookRunStatus = "running" | "success" | "failed";

/** `call` is a run another notebook asked for, through `notebooks.run`. */
export type NotebookRunTrigger = "manual" | "cell" | "cron" | "webhook" | "call";

export interface CellLogEntry {
  level: string;
  msg: string;
}

export interface RecordedCellResult {
  /**
   * The code that actually ran, recorded for successes *and* failures.
   *
   * Two jobs: comparing it with the cell's current code is what makes freshness
   * computable, and showing it answers the first question about any past failure —
   * which version of the code produced it. Freshness only trusts it when there is
   * no `error`; display does not care.
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
  /**
   * The run that asked for this one, when a notebook called another.
   *
   * Without it a callee's history is a list of runs with no explanation — you would see
   * that it ran at 03:00 and have no way to find out what set it off.
   */
  parent_run_id: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface NotebookRunDetail extends NotebookRunSummary {
  cell_results: Record<string, RecordedCellResult>;
}

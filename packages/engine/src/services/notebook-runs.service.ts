import { pool } from "../db/connection.js";
import { resignStorageLinks } from "../core/storage-links.js";
import type {

  NotebookRunDetail,
  NotebookRunStatus,
  NotebookRunSummary,
  NotebookRunTrigger,
  RecordedCellResult,
} from "@zaa-tool/shared";

/** Keeps one cell's history useful for debugging without letting a row grow without bound. */
const MAX_LOGS_PER_CELL = 100;
const MAX_LOG_LENGTH = 2_000;

/**
 * Runs kept per notebook. A cron firing every minute would otherwise add ~1,440 rows
 * a day, so retention is bounded automatically rather than left to someone remembering
 * to prune. Old runs are dropped when a new one starts.
 */
const MAX_RUNS_PER_NOTEBOOK = 50;

const SUMMARY_COLUMNS =
  "id, notebook_id, status, trigger_source, cell_id, parent_run_id, started_by, error, started_at, finished_at";

function truncateLogs(result: RecordedCellResult): RecordedCellResult {
  if (!result.logs || result.logs.length === 0) return result;
  return {
    ...result,
    logs: result.logs.slice(-MAX_LOGS_PER_CELL).map((log) => ({
      level: log.level,
      msg: log.msg.length > MAX_LOG_LENGTH ? `${log.msg.slice(0, MAX_LOG_LENGTH)}…` : log.msg,
    })),
  };
}

export class NotebookRunsService {
  async start(run: {
    runId: string;
    notebookId: string;
    triggerSource: NotebookRunTrigger;
    cellId?: string;
    /** Set when another notebook's run asked for this one. */
    parentRunId?: string;
    /** The account that asked, if one did. Absent for a schedule, a webhook or a share link. */
    startedBy?: string;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO notebook_runs (id, notebook_id, status, trigger_source, cell_id, parent_run_id, started_by)
       VALUES ($1, $2, 'running', $3, $4, $5, $6)`,
      [
        run.runId,
        run.notebookId,
        run.triggerSource,
        run.cellId ?? null,
        run.parentRunId ?? null,
        run.startedBy ?? null,
      ]
    );

    await this.pruneOldRuns(run.notebookId);
  }

  private async pruneOldRuns(notebookId: string): Promise<void> {
    await pool.query(
      `DELETE FROM notebook_runs
       WHERE notebook_id = $1
         AND id NOT IN (
           SELECT id FROM notebook_runs
           WHERE notebook_id = $1
           ORDER BY started_at DESC
           LIMIT $2
         )`,
      [notebookId, MAX_RUNS_PER_NOTEBOOK]
    );
  }

  async deleteByNotebook(notebookId: string): Promise<{ deleted: number }> {
    const { rowCount } = await pool.query("DELETE FROM notebook_runs WHERE notebook_id = $1", [
      notebookId,
    ]);
    return { deleted: rowCount ?? 0 };
  }

  /**
   * Writes one cell's result with `jsonb_set` so concurrent lanes cannot overwrite
   * each other. A read-modify-write here would silently drop results.
   */
  async recordCell(runId: string, cellId: string, result: RecordedCellResult): Promise<void> {
    await pool.query(
      `UPDATE notebook_runs
       SET cell_results = jsonb_set(cell_results, ARRAY[$2], $3::jsonb, true)
       WHERE id = $1`,
      [runId, cellId, JSON.stringify(truncateLogs(result))]
    );
  }

  async finish(runId: string, status: NotebookRunStatus, error?: string): Promise<void> {
    await pool.query(
      `UPDATE notebook_runs
       SET status = $2, error = $3, finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [runId, status, error ?? null]
    );
  }

  /**
   * `startedBy` narrows the history to one account's own runs — what somebody who only uses
   * a page is allowed to read. Whether a caller gets that narrower view is the access
   * module's decision (`runScope`); this only does what it is told.
   */
  async listByNotebook(
    notebookId: string,
    limit = 20,
    startedBy?: string
  ): Promise<NotebookRunSummary[]> {
    const { rows } = await pool.query(
      `SELECT ${SUMMARY_COLUMNS} FROM notebook_runs
       WHERE notebook_id = $1 AND ($3::text IS NULL OR started_by = $3)
       ORDER BY started_at DESC
       LIMIT $2`,
      [notebookId, limit, startedBy ?? null]
    );
    return resignStorageLinks(rows) as NotebookRunSummary[];
  }

  async getById(runId: string): Promise<NotebookRunDetail | null> {
    const { rows } = await pool.query(
      `SELECT ${SUMMARY_COLUMNS}, cell_results FROM notebook_runs WHERE id = $1`,
      [runId]
    );
    return rows[0] ? (resignStorageLinks(this.parseDetail(rows[0])) as NotebookRunDetail) : null;
  }

  /** The run whose results the editor restores when a notebook is opened. */
  async getLatestForNotebook(
    notebookId: string,
    startedBy?: string
  ): Promise<NotebookRunDetail | null> {
    const { rows } = await pool.query(
      `SELECT ${SUMMARY_COLUMNS}, cell_results FROM notebook_runs
       WHERE notebook_id = $1 AND ($2::text IS NULL OR started_by = $2)
       ORDER BY started_at DESC
       LIMIT 1`,
      [notebookId, startedBy ?? null]
    );
    return rows[0] ? (resignStorageLinks(this.parseDetail(rows[0])) as NotebookRunDetail) : null;
  }



  private parseDetail(row: NotebookRunDetail & { cell_results: unknown }): NotebookRunDetail {
    return {
      ...row,
      // jsonb comes back parsed, but tolerate a string in case the column is ever TEXT.
      cell_results:
        typeof row.cell_results === "string"
          ? JSON.parse(row.cell_results)
          : ((row.cell_results ?? {}) as NotebookRunDetail["cell_results"]),
    };
  }
}

export const notebookRunsService = new NotebookRunsService();

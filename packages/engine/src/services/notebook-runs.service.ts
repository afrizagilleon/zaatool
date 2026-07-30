import { pool } from "../db/connection.js";
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
  "id, notebook_id, status, trigger_source, cell_id, error, started_at, finished_at";

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
  }): Promise<void> {
    await pool.query(
      `INSERT INTO notebook_runs (id, notebook_id, status, trigger_source, cell_id)
       VALUES ($1, $2, 'running', $3, $4)`,
      [run.runId, run.notebookId, run.triggerSource, run.cellId ?? null]
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

  async listByNotebook(notebookId: string, limit = 20): Promise<NotebookRunSummary[]> {
    const { rows } = await pool.query(
      `SELECT ${SUMMARY_COLUMNS} FROM notebook_runs
       WHERE notebook_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [notebookId, limit]
    );
    return rows;
  }

  async getById(runId: string): Promise<NotebookRunDetail | null> {
    const { rows } = await pool.query(
      `SELECT ${SUMMARY_COLUMNS}, cell_results FROM notebook_runs WHERE id = $1`,
      [runId]
    );
    return rows[0] ? this.parseDetail(rows[0]) : null;
  }

  /** The run whose results the editor restores when a notebook is opened. */
  async getLatestForNotebook(notebookId: string): Promise<NotebookRunDetail | null> {
    const { rows } = await pool.query(
      `SELECT ${SUMMARY_COLUMNS}, cell_results FROM notebook_runs
       WHERE notebook_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [notebookId]
    );
    return rows[0] ? this.parseDetail(rows[0]) : null;
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

import { pool } from "../db/connection.js";
import { resignStorageLinks } from "../core/storage-links.js";
import type { Actor } from "../core/actor.js";
import { currentContext } from "../core/request-context.js";
import { runRetentionDays } from "../config.js";
import { createRedactor } from "../core/secret-redactor.js";
import { logger } from "../core/logger.js";
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
 * to prune. Old runs are dropped when a new one starts — finished ones only: a run that
 * is still going is not history yet, and deleting its row would lose its result and make
 * it impossible to cancel.
 */
const MAX_RUNS_PER_NOTEBOOK = 50;

/** Rows rewritten per round trip when old secret values are scrubbed from history. */
const SCRUB_BATCH = 100;

export const INTERRUPTED_RUN_ERROR = "the engine restarted while this run was in progress";

const SUMMARY_COLUMNS =
  "id, notebook_id, status, trigger_source, cell_id, parent_run_id, version_id, started_by, actor_type, agent_token_id, agent_client, trigger_id, error, started_at, finished_at";

/** What the run row says about who set it off, beyond `started_by`. */
export interface RunAttribution {
  actorType: string | null;
  agentTokenId: string | null;
  agentClient: string | null;
  triggerId: string | null;
}

/**
 * Who started a run, from the actor the request was authenticated as.
 *
 * `started_by` alone cannot tell a person pressing Run from their agent calling
 * `notebook_run` (both carry the owner's id), nor name the webhook or cron trigger behind
 * a run that has no user. With no context (a service called from a script or a test) or an
 * actor that was never established, it falls back to what the options themselves say.
 * A nested call inherits the root's actor: the context travels with the work.
 */
export function attributionOf(
  actor: Actor | undefined,
  fallback: { startedBy?: string; triggerSource?: string }
): RunAttribution {
  const none: RunAttribution = { actorType: null, agentTokenId: null, agentClient: null, triggerId: null };
  if (actor && actor.type !== "anonymous") {
    switch (actor.type) {
      case "agent":
        return { ...none, actorType: "agent", agentTokenId: actor.tokenId, agentClient: actor.client ?? null };
      case "webhook":
      case "cron":
        return { ...none, actorType: actor.type, triggerId: actor.triggerId };
      default:
        return { ...none, actorType: actor.type };
    }
  }
  if (fallback.startedBy) return { ...none, actorType: "user" };
  if (fallback.triggerSource === "cron" || fallback.triggerSource === "webhook") {
    return { ...none, actorType: fallback.triggerSource };
  }
  return none;
}

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
    /** The deployed version being executed; null for a draft run. */
    versionId: string | null;
    /** The account that asked, if one did. Absent for a schedule, a webhook or a share link. */
    startedBy?: string;
    /** The share link that asked, if one did: what lets a socket opened with it follow this run and no other. */
    shareId?: string;
  }): Promise<void> {
    const who = attributionOf(currentContext()?.actor, run);
    await pool.query(
      `INSERT INTO notebook_runs
         (id, notebook_id, status, trigger_source, cell_id, parent_run_id, version_id, started_by,
          actor_type, agent_token_id, agent_client, trigger_id, share_id)
       VALUES ($1, $2, 'running', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        run.runId,
        run.notebookId,
        run.triggerSource,
        run.cellId ?? null,
        run.parentRunId ?? null,
        run.versionId,
        run.startedBy ?? null,
        who.actorType,
        who.agentTokenId,
        who.agentClient,
        who.triggerId,
        run.shareId ?? null,
      ]
    );

    await this.pruneOldRuns(run.notebookId);
  }

  /**
   * Drops finished runs older than `RUN_RETENTION_DAYS` (default 90), across every notebook.
   * The per-notebook cap alone keeps a busy notebook's last 50 runs forever, which for a
   * notebook that fires once a month is years of whatever its cells printed. A run that is
   * still going is never touched. Called at boot and then daily.
   */
  async pruneExpired(): Promise<number> {
    const days = runRetentionDays();
    const { rowCount } = await pool.query(
      `DELETE FROM notebook_runs
       WHERE status <> 'running'
         AND COALESCE(finished_at, started_at) < CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')`,
      [days]
    );
    return rowCount ?? 0;
  }

  /**
   * Rewrites the stored history so a secret that has been changed or deleted no longer
   * appears in it, replacing the old value (in every encoding the redactor knows) with
   * `[secret:NAME]`.
   *
   * Covers the runs of `ownerId`'s notebooks, and the runs `ownerId` started on other
   * people's notebooks: an editor's draft run uses the editor's own secret, and it is
   * recorded under the owner's notebook.
   *
   * Done in the request that changed the secret, in batches of 100 rows walked by id, so a
   * long history is not one huge statement and a failure half-way leaves the rest still
   * scrubbable by a retry. Rows that do not contain the value are not written.
   */
  async scrubSecret(ownerId: string, secrets: Record<string, string>): Promise<number> {
    const redactor = createRedactor(secrets);
    if (redactor.empty) return 0;

    let rewritten = 0;
    let after = "";
    for (;;) {
      const { rows } = await pool.query<{
        id: string;
        cell_results: unknown;
        error: string | null;
        outputs: unknown;
      }>(
        `SELECT r.id, r.cell_results, r.error, r.outputs
         FROM notebook_runs r
         LEFT JOIN notebooks n ON n.id = r.notebook_id
         WHERE (n.owner_id = $1 OR r.started_by = $1) AND r.id > $2
         ORDER BY r.id
         LIMIT $3`,
        [ownerId, after, SCRUB_BATCH]
      );
      if (rows.length === 0) break;
      after = rows[rows.length - 1].id;

      for (const row of rows) {
        const cells = redactor.value(row.cell_results);
        const error = row.error === null ? null : redactor.string(row.error);
        const outputs = row.outputs === null ? null : redactor.value(row.outputs);
        if (cells === row.cell_results && error === row.error && outputs === row.outputs) continue;
        await pool.query(
          "UPDATE notebook_runs SET cell_results = $2::jsonb, error = $3, outputs = $4::jsonb WHERE id = $1",
          [row.id, JSON.stringify(cells), error, outputs === null ? null : JSON.stringify(outputs)]
        );
        rewritten += 1;
      }
    }
    if (rewritten > 0) {
      logger.info("Scrubbed a changed secret from run history", {
        event: "secrets.scrub",
        ownerId,
        runs: rewritten,
      });
    }
    return rewritten;
  }

  private async pruneOldRuns(notebookId: string): Promise<void> {
    await pool.query(
      `DELETE FROM notebook_runs
       WHERE notebook_id = $1
         AND status <> 'running'
         AND id NOT IN (
           SELECT id FROM notebook_runs
           WHERE notebook_id = $1 AND status <> 'running'
           ORDER BY started_at DESC
           LIMIT $2
         )`,
      [notebookId, MAX_RUNS_PER_NOTEBOOK]
    );
  }

  /**
   * Called once at boot, before the engine takes any request. Every run left `running` by a
   * previous process died with it (the process tree is gone, nothing will ever finish the
   * row), so it is closed as failed instead of hanging in the history and answering a cancel
   * with "Run is not active" forever.
   */
  async failInterrupted(): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE notebook_runs
       SET status = 'failed', error = $1, finished_at = CURRENT_TIMESTAMP
       WHERE status = 'running'`,
      [INTERRUPTED_RUN_ERROR]
    );
    return rowCount ?? 0;
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

  async finish(
    runId: string,
    status: NotebookRunStatus,
    error?: string,
    outputs?: Record<string, unknown>
  ): Promise<void> {
    await pool.query(
      `UPDATE notebook_runs
       SET status = $2, error = $3, finished_at = CURRENT_TIMESTAMP, outputs = $4::jsonb
       WHERE id = $1`,
      [runId, status, error ?? null, outputs === undefined ? null : JSON.stringify(outputs)]
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
      `SELECT ${SUMMARY_COLUMNS}, cell_results, outputs, share_id FROM notebook_runs WHERE id = $1`,
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
      `SELECT ${SUMMARY_COLUMNS}, cell_results, outputs, share_id FROM notebook_runs
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

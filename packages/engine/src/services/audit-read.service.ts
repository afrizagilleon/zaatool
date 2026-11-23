import { pool } from "../db/connection.js";

/**
 * Reading the audit trail back, for the people it is about.
 *
 * Read-only by construction: nothing here writes, and there is no route that changes or
 * deletes a row. What a caller may see is decided here, in the query, rather than by
 * filtering rows afterwards: a `creator` sees everything (they run the installation), and
 * anybody else sees the events they performed and the events about things they own.
 */

export interface AuditEventDto {
  id: string;
  /** ISO 8601, UTC. */
  at: string;
  action: string;
  outcome: "success" | "failure" | "denied";
  /** `actorFields()` keys without the `actor.` prefix. */
  actor: Record<string, string>;
  target: { type: string; id: string | null; ownerId: string | null; name?: string };
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  meta: Record<string, unknown>;
}

export interface AuditFilter {
  action?: string;
  actorType?: string;
  targetType?: string;
  targetId?: string;
  outcome?: string;
}

export interface AuditViewer {
  id: string;
  role: string;
}

const OUTCOMES = new Set(["success", "failure", "denied"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const EXPORT_BATCH = 1000;

/** Which column carries which actor field, in the order the DTO lists them. */
const ACTOR_FIELDS: [string, string][] = [
  ["user_id", "user_id"],
  ["username", "username"],
  ["token_id", "token_id"],
  ["label", "label"],
  ["client", "client"],
  ["trigger_id", "trigger_id"],
  ["share_id", "share_id"],
  ["notebook_id", "actor_notebook_id"],
  ["command", "command"],
  ["os_user", "os_user"],
  ["component", "component"],
];

type Row = Record<string, unknown> & { id: string | number; occurred_at: Date };

export function toDto(row: Row): AuditEventDto {
  const actor: Record<string, string> = { type: String(row.actor_type) };
  for (const [field, column] of ACTOR_FIELDS) {
    const value = row[column];
    if (value !== null && value !== undefined) actor[field] = String(value);
  }
  return {
    id: String(row.id),
    at: new Date(row.occurred_at).toISOString(),
    action: String(row.action),
    outcome: row.outcome as AuditEventDto["outcome"],
    actor,
    target: {
      type: row.target_type ? String(row.target_type) : "none",
      id: (row.target_id as string | null) ?? null,
      ownerId: (row.target_owner_id as string | null) ?? null,
      ...(row.target_name ? { name: String(row.target_name) } : {}),
    },
    ip: (row.ip as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    requestId: (row.request_id as string | null) ?? null,
    meta: (row.meta as Record<string, unknown>) ?? {},
  };
}

/** `LIKE` treats `%` and `_` as wildcards; a prefix filter means the characters it was typed with. */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, "\\$&")}%`;
}

/** The WHERE clause and its parameters. */
function where(
  viewer: AuditViewer,
  filter: AuditFilter,
  extra: { before?: string; after?: string }
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown): void => {
    params.push(value);
    clauses.push(clause.replace("?", `$${params.length}`));
  };

  if (viewer.role !== "creator") {
    params.push(viewer.id);
    clauses.push(`(user_id = $${params.length} OR target_owner_id = $${params.length})`);
  }
  if (filter.action) add("action LIKE ? ESCAPE '\\'", likePrefix(filter.action));
  if (filter.actorType) add("actor_type = ?", filter.actorType);
  if (filter.targetType) add("target_type = ?", filter.targetType);
  if (filter.targetId) add("target_id = ?", filter.targetId);
  if (filter.outcome) add("outcome = ?", filter.outcome);
  if (extra.before) add("id < ?::bigint", extra.before);
  if (extra.after) add("id > ?::bigint", extra.after);
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/** A filter value that is not what it says it is is a request error, not an empty answer. */
export class AuditQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditQueryError";
  }
}

function checked(filter: AuditFilter, before?: string): void {
  if (filter.outcome && !OUTCOMES.has(filter.outcome)) {
    throw new AuditQueryError("outcome must be success, failure or denied.");
  }
  if (before !== undefined && !/^\d{1,18}$/.test(before)) {
    throw new AuditQueryError("before must be an event id.");
  }
}

export class AuditReadService {
  /** Newest first. `next` is the cursor for the page after this one (`before=<next>`), or null at the end. */
  async list(
    viewer: AuditViewer,
    filter: AuditFilter,
    options: { limit?: number; before?: string } = {}
  ): Promise<{ events: AuditEventDto[]; next: string | null }> {
    checked(filter, options.before);
    const limit = Math.min(Math.max(Math.floor(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const { sql, params } = where(viewer, filter, { before: options.before });
    // One more than asked for, to know whether there is a next page without counting.
    const { rows } = await pool.query<Row>(
      `SELECT * FROM audit_events ${sql} ORDER BY id DESC LIMIT ${limit + 1}`,
      params
    );
    const page = rows.slice(0, limit);
    return {
      events: page.map(toDto),
      next: rows.length > limit ? String(page[page.length - 1].id) : null,
    };
  }

  /**
   * Every matching event, oldest first, one at a time, for `write` to put on the wire. In
   * batches by id so a long trail is never held in memory. Oldest first because a SIEM
   * ingests in order and a re-export can resume from the last id it saw.
   */
  async export(
    viewer: AuditViewer,
    filter: AuditFilter,
    write: (event: AuditEventDto) => Promise<void> | void,
    stillOpen: () => boolean = () => true
  ): Promise<number> {
    checked(filter);
    let after = "0";
    let sent = 0;
    while (stillOpen()) {
      const { sql, params } = where(viewer, filter, { after });
      const { rows } = await pool.query<Row>(
        `SELECT * FROM audit_events ${sql} ORDER BY id ASC LIMIT ${EXPORT_BATCH}`,
        params
      );
      for (const row of rows) {
        await write(toDto(row));
        sent += 1;
      }
      if (rows.length < EXPORT_BATCH) break;
      after = String(rows[rows.length - 1].id);
    }
    return sent;
  }
}

export const auditReadService = new AuditReadService();

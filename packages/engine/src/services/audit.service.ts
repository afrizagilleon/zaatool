import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/connection.js";
import { auditRetentionDays } from "../config.js";
import { actorFields, type Actor } from "../core/actor.js";
import { LOCK_KEYS, lockUntilTransactionEnds } from "../core/advisory-locks.js";
import { logger, scrub } from "../core/logger.js";
import { currentContext, withContext } from "../core/request-context.js";

/**
 * The audit trail: who did what to what, and how it ended.
 *
 * Not the operational log (that is for operators, goes to stdout and may be rotated away)
 * and not a run's history (the app prunes that, and deletes it with its notebook). Rows
 * here are written once, kept for `AUDIT_RETENTION_DAYS`, and chained by hash so that
 * changing or removing one is detectable. The table has no foreign keys on purpose: a row
 * about a deleted user, token or notebook is exactly the row somebody will want later.
 *
 * **Writing never breaks the action.** `record` awaits the insert (so a caller that needs
 * the row to exist, or a test, can rely on it) but swallows a failure after logging it as
 * `audit.write_failed` at error level. The alternative — failing the user's request because
 * the trail could not be written — would let a full disk or a locked table lock everybody
 * out, including the creator who would have to fix it. A lost row is visible in the
 * operational log, and a gap in ids/hash chain can only come from outside the engine.
 *
 * **What goes in `meta`.** Names and small facts: a secret's *key*, a role before and after,
 * a revision number. Never a secret value, a password, a token or a webhook slug. It is
 * passed through the logger's `scrub()` (which redacts credential-named keys at any depth)
 * and capped, but the rule is the caller's: do not hand it anything you would not print.
 */

export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditTarget {
  type: string;
  id?: string | null;
  /** The user who owns the thing, which is what lets an owner see events about it. */
  ownerId?: string | null;
  /** Its name as it was when this happened. */
  name?: string | null;
}

export interface AuditInput {
  /** `noun.verb`, e.g. `notebook.deploy`. The read API filters by prefix. */
  action: string;
  outcome?: AuditOutcome;
  target?: AuditTarget;
  meta?: Record<string, unknown>;
  /** For the rare event written before the context knows who it is (a failed sign-in names nobody). */
  actor?: Actor;
}

/** The chain's first `prev_hash`. */
export const GENESIS_HASH = "0".repeat(64);

const MAX_TEXT = 512;
const MAX_META_BYTES = 8 * 1024;

/** Control characters out (a newline in a name must not forge a second line in an export), length capped. */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  // eslint-disable-next-line no-control-regex
  const clean = String(value).replace(/[\u0000-\u001f\u007f]/g, " ");
  return clean.length > MAX_TEXT ? clean.slice(0, MAX_TEXT) : clean;
}

/** Strings inside `meta` get the same cleaning as the columns; jsonb cannot hold a NUL at all. */
function cleanStrings(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return text(value) ?? "";
  if (value === null || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.map((entry) => cleanStrings(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [text(k) ?? "", cleanStrings(v, depth + 1)])
  );
}

function safeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  // The JSON round trip drops `undefined` and turns anything exotic into plain data, so what
  // is hashed is what the database will hand back.
  const plain = JSON.parse(JSON.stringify(cleanStrings(scrub(meta)))) as Record<string, unknown>;
  return JSON.stringify(plain).length > MAX_META_BYTES ? { truncated: true } : plain;
}

/** Same value, object keys sorted at every depth: jsonb does not keep the order they were written in. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sorted(v)])
  );
}

/** The columns a hash covers, in one fixed order. */
interface HashedRow {
  id: string;
  occurred_at: string;
  action: string;
  outcome: string;
  actor_type: string;
  user_id: string | null;
  username: string | null;
  token_id: string | null;
  label: string | null;
  client: string | null;
  trigger_id: string | null;
  share_id: string | null;
  actor_notebook_id: string | null;
  command: string | null;
  os_user: string | null;
  component: string | null;
  target_type: string | null;
  target_id: string | null;
  target_owner_id: string | null;
  target_name: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  meta: Record<string, unknown>;
}

const HASHED_COLUMNS = [
  "id",
  "occurred_at",
  "action",
  "outcome",
  "actor_type",
  "user_id",
  "username",
  "token_id",
  "label",
  "client",
  "trigger_id",
  "share_id",
  "actor_notebook_id",
  "command",
  "os_user",
  "component",
  "target_type",
  "target_id",
  "target_owner_id",
  "target_name",
  "ip",
  "user_agent",
  "request_id",
] as const;

/** What `hash` is the digest of, together with the previous hash. A JSON array, so no field can bleed into the next. */
export function canonicalRow(row: HashedRow): string {
  return JSON.stringify([...HASHED_COLUMNS.map((column) => row[column]), sorted(row.meta)]);
}

export function chainHash(prevHash: string, row: HashedRow): string {
  return createHash("sha256").update(prevHash).update("\n").update(canonicalRow(row)).digest("hex");
}

/** How the actor's flat fields map onto columns. */
const ACTOR_COLUMN: Record<string, keyof HashedRow> = {
  "actor.user_id": "user_id",
  "actor.username": "username",
  "actor.token_id": "token_id",
  "actor.label": "label",
  "actor.client": "client",
  "actor.trigger_id": "trigger_id",
  "actor.share_id": "share_id",
  "actor.notebook_id": "actor_notebook_id",
  "actor.command": "command",
  "actor.os_user": "os_user",
  "actor.component": "component",
};

export interface ChainVerdict {
  ok: boolean;
  /** Rows read. */
  checked: number;
  firstId: string | null;
  lastId: string | null;
  /**
   * The `prev_hash` of the oldest row left. The genesis value means the chain is complete
   * from its start; anything else is the hash of a row the retention job removed, taken on
   * trust because there is nothing left to compare it with. Compare it with an earlier
   * export or an `audit.prune` event to be sure of it.
   */
  anchor: string | null;
  /** The first row that does not fit, and why. */
  brokenAt?: { id: string; reason: "hash-mismatch" | "chain-broken" };
}

/** A window of repeated refusals from one source, so a flood cannot fill the table. */
interface Burst {
  windowStart: number;
  count: number;
  suppressed: number;
  action: string;
  ip: string;
}

/** How many refusals per action and address are written per minute before the rest are only counted. */
const BURST_LIMIT = 20;
const BURST_WINDOW_MS = 60_000;
const MAX_TRACKED_BURSTS = 5_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export class AuditService {
  private readonly bursts = new Map<string, Burst>();
  private retentionTimer: NodeJS.Timeout | null = null;

  /**
   * Writes one event, as the actor, address and request the current context names.
   * Resolves when the row is committed; never rejects (see the note at the top).
   */
  async record(input: AuditInput): Promise<void> {
    try {
      const context = currentContext();
      const actor = input.actor ?? context?.actor;
      const outcome = input.outcome ?? "success";

      // Refusals and failures are what a stranger, or a script gone wrong, can produce in
      // bulk (a password guess, a bad webhook secret, a 403 in a loop), so they are rationed
      // per action and address. Successes are never dropped.
      if (outcome !== "success" && this.rationed(input.action, context?.ip ?? "unknown")) return;

      await this.append({
        action: input.action,
        outcome,
        actor,
        target: input.target,
        meta: input.meta,
        ip: context?.ip,
        userAgent: context?.userAgent,
        requestId: context?.requestId,
      });
    } catch (err: unknown) {
      logger.error("Could not write an audit event", {
        event: "audit.write_failed",
        err,
        audit_action: input.action,
      });
    }
  }

  /** True when this refusal is over the per-minute allowance and should only be counted. */
  private rationed(action: string, ip: string): boolean {
    const now = Date.now();
    const key = `${action}|${ip}`;
    let burst = this.bursts.get(key);
    if (burst && now - burst.windowStart >= BURST_WINDOW_MS) {
      this.report(burst);
      this.bursts.delete(key);
      burst = undefined;
    }
    if (!burst) {
      if (this.bursts.size >= MAX_TRACKED_BURSTS) this.sweepBursts(now);
      burst = { windowStart: now, count: 0, suppressed: 0, action, ip };
      this.bursts.set(key, burst);
    }
    burst.count += 1;
    if (burst.count <= BURST_LIMIT) return false;
    burst.suppressed += 1;
    return true;
  }

  private sweepBursts(now: number): void {
    for (const [key, burst] of this.bursts) {
      if (now - burst.windowStart >= BURST_WINDOW_MS) {
        this.report(burst);
        this.bursts.delete(key);
      }
    }
  }

  /** The one row that stands for the refusals that were not written, so a flood is still visible. */
  private report(burst: Burst): void {
    if (burst.suppressed === 0) return;
    void withContext({ actor: { type: "system", component: "audit" }, ip: burst.ip }, () =>
      this.record({
        action: "audit.suppressed",
        outcome: "denied",
        meta: { action: burst.action, suppressed: burst.suppressed, windowSeconds: BURST_WINDOW_MS / 1000 },
      })
    );
  }

  private async append(event: {
    action: string;
    outcome: AuditOutcome;
    actor: Actor | undefined;
    target?: AuditTarget;
    meta?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
    requestId?: string;
  }): Promise<void> {
    const flat = actorFields(event.actor ?? { type: "anonymous" });
    const meta = safeMeta(event.meta);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Everything from reading the last hash to the insert is one critical section.
      await lockUntilTransactionEnds(client, LOCK_KEYS.auditChain);

      const last = await client.query<{ hash: string }>(
        "SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1"
      );
      const prevHash = last.rows[0]?.hash ?? GENESIS_HASH;
      const { rows: seq } = await client.query<{ id: string }>(
        "SELECT nextval(pg_get_serial_sequence('audit_events', 'id'))::text AS id"
      );

      const row: HashedRow = {
        id: seq[0].id,
        // Taken inside the lock so time never runs backwards along the chain, which is what
        // lets the retention job remove "everything before a date" as a prefix.
        occurred_at: new Date().toISOString(),
        action: text(event.action) ?? "unknown",
        outcome: event.outcome,
        actor_type: flat["actor.type"] ?? "anonymous",
        user_id: null,
        username: null,
        token_id: null,
        label: null,
        client: null,
        trigger_id: null,
        share_id: null,
        actor_notebook_id: null,
        command: null,
        os_user: null,
        component: null,
        target_type: text(event.target?.type),
        target_id: text(event.target?.id),
        target_owner_id: text(event.target?.ownerId),
        target_name: text(event.target?.name),
        ip: text(event.ip),
        user_agent: text(event.userAgent),
        request_id: text(event.requestId),
        meta,
      };
      for (const [key, column] of Object.entries(ACTOR_COLUMN)) {
        const value = flat[key];
        if (value !== undefined) (row as unknown as Record<string, unknown>)[column] = text(value);
      }

      await client.query(
        `INSERT INTO audit_events (
           id, occurred_at, action, outcome, actor_type, user_id, username, token_id, label, client,
           trigger_id, share_id, actor_notebook_id, command, os_user, component,
           target_type, target_id, target_owner_id, target_name, ip, user_agent, request_id,
           meta, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [
          ...HASHED_COLUMNS.map((column) => row[column]),
          JSON.stringify(row.meta),
          prevHash,
          chainHash(prevHash, row),
        ]
      );
      await client.query("COMMIT");
    } catch (err: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Re-reads the whole trail in order and checks that every row's hash is what its content
   * and its predecessor's hash say it should be.
   *
   * The oldest row is the anchor: if retention removed earlier rows, its `prev_hash` points
   * at one that is gone and is accepted as given (it is reported as `anchor`); only the
   * links *after* it are checked. That means a rewrite of the oldest rows' neighbours is
   * caught but the removal of the newest rows is not, which no chain can show on its own —
   * keep an exported copy to compare against.
   */
  async verifyChain(): Promise<ChainVerdict> {
    const verdict: ChainVerdict = { ok: true, checked: 0, firstId: null, lastId: null, anchor: null };
    let after = "0";
    let expectedPrev: string | null = null;

    for (;;) {
      const { rows } = await pool.query(
        `SELECT *, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_iso
         FROM audit_events WHERE id > $1::bigint ORDER BY id ASC LIMIT 500`,
        [after]
      );
      if (rows.length === 0) break;

      for (const raw of rows) {
        const row: HashedRow = {
          ...HASHED_COLUMNS.reduce((acc, column) => ({ ...acc, [column]: raw[column] ?? null }), {} as HashedRow),
          id: String(raw.id),
          occurred_at: raw.occurred_iso,
          meta: raw.meta ?? {},
        };
        if (verdict.firstId === null) {
          verdict.firstId = row.id;
          verdict.anchor = raw.prev_hash;
        } else if (raw.prev_hash !== expectedPrev) {
          return { ...verdict, ok: false, brokenAt: { id: row.id, reason: "chain-broken" } };
        }
        if (chainHash(raw.prev_hash, row) !== raw.hash) {
          return { ...verdict, ok: false, brokenAt: { id: row.id, reason: "hash-mismatch" } };
        }
        expectedPrev = raw.hash;
        verdict.checked += 1;
        verdict.lastId = row.id;
      }
      after = String(rows[rows.length - 1].id);
    }
    return verdict;
  }

  /**
   * Removes rows older than `retentionDays`, as a prefix of the chain, and records that it
   * did. The newest row is never removed, so the chain always has something to continue
   * from; the oldest row left becomes the anchor `verifyChain` reports.
   */
  async prune(retentionDays: number, now: Date = new Date()): Promise<{ deleted: number; throughId: string | null }> {
    if (retentionDays <= 0) return { deleted: 0, throughId: null };
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

    const client: PoolClient = await pool.connect();
    let result: { deleted: number; throughId: string | null };
    try {
      await client.query("BEGIN");
      // `LOCAL`: the permission to delete lasts for this transaction and cannot leak into
      // the pooled connection's next user.
      await client.query("SET LOCAL zaatool.audit_prune = 'on'");
      await lockUntilTransactionEnds(client, LOCK_KEYS.auditChain);
      const { rows } = await client.query<{ deleted: string; through: string | null }>(
        `WITH cut AS (
           SELECT max(id) AS through FROM audit_events
           WHERE occurred_at < $1 AND id < (SELECT max(id) FROM audit_events)
         ), gone AS (
           DELETE FROM audit_events WHERE id <= (SELECT through FROM cut) RETURNING id
         )
         SELECT (SELECT count(*) FROM gone)::text AS deleted, (SELECT through FROM cut)::text AS through`,
        [cutoff.toISOString()]
      );
      await client.query("COMMIT");
      result = { deleted: Number(rows[0].deleted), throughId: rows[0].through };
    } catch (err: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    if (result.deleted > 0) {
      await withContext({ actor: { type: "system", component: "audit-retention" } }, () =>
        this.record({
          action: "audit.prune",
          meta: { deleted: result.deleted, throughId: result.throughId, olderThan: cutoff.toISOString(), retentionDays },
        })
      );
    }
    return result;
  }

  /** One prune now and one every 24 hours, until `stopRetention`. A failure is logged and tried again tomorrow. */
  startRetention(days: () => number = auditRetentionDays): void {
    if (this.retentionTimer) return;
    const run = async (): Promise<void> => {
      try {
        const { deleted } = await withContext({ actor: { type: "system", component: "audit-retention" } }, () =>
          this.prune(days())
        );
        if (deleted > 0) logger.info("Pruned old audit events", { event: "audit.pruned", deleted });
      } catch (err: unknown) {
        logger.error("Audit retention failed", { event: "audit.prune_failed", err });
      }
    };
    void run();
    this.retentionTimer = setInterval(() => void run(), DAY_MS);
    this.retentionTimer.unref();
  }

  stopRetention(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }
}

export const audit = new AuditService();

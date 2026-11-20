import { pool } from "../db/connection.js";
import { lastSandboxUid, type SandboxConfig } from "../core/sandbox-identity.js";

/** Every uid in the range is taken. Says what to change, because the operator reads this. */
export class SandboxUidExhaustedError extends Error {
  constructor(config: SandboxConfig) {
    super(
      `All ${config.uidCount} sandbox user ids (${config.uidBase}..${lastSandboxUid(config)}) are in use, so ` +
        "this account's notebooks cannot run. Raise SANDBOX_UID_COUNT."
    );
    this.name = "SandboxUidExhaustedError";
  }
}

/** Held while a uid is chosen, so two first runs of different accounts cannot pick the same one. */
const ALLOCATION_LOCK = 20_241_120;

/** Owners seen this process, so a run does not ask the database who it is every time. */
const known = new Map<string, number>();

/**
 * The uid an account's cells run as: the one it already has, or the next free one in
 * `uidBase .. uidBase + uidCount - 1`, recorded in `users.sandbox_uid`.
 *
 * Lazy on purpose. An account that never runs a notebook never takes a uid, and nothing
 * has to be provisioned when an account is made. The next one is one past the highest ever
 * handed out in this range (`sandbox_uid_highwater`, which never goes down) or in use on
 * `users`, whichever is higher, so a uid freed by a deleted account — even the newest one —
 * is never given to someone else, who would otherwise inherit whatever it left in its home
 * folder. The UNIQUE column is the backstop under the advisory lock.
 */
export async function sandboxUidFor(userId: string, config: SandboxConfig): Promise<number> {
  const cached = known.get(userId);
  if (cached !== undefined && cached >= config.uidBase && cached <= lastSandboxUid(config)) return cached;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [ALLOCATION_LOCK]);

    const { rows: mine } = await client.query<{ sandbox_uid: number | null }>(
      "SELECT sandbox_uid FROM users WHERE id = $1",
      [userId]
    );
    if (!mine[0]) throw new Error(`There is no account ${userId} to give a sandbox user id.`);

    const current = mine[0].sandbox_uid;
    if (current !== null && current >= config.uidBase && current <= lastSandboxUid(config)) {
      await client.query("COMMIT");
      known.set(userId, current);
      return current;
    }

    const { rows: top } = await client.query<{ next: number }>(
      `SELECT GREATEST(
         COALESCE((SELECT last_uid + 1 FROM sandbox_uid_highwater WHERE uid_base = $1), $1::int),
         COALESCE((SELECT MAX(sandbox_uid) + 1 FROM users WHERE sandbox_uid >= $1), $1::int)
       ) AS next`,
      [config.uidBase]
    );
    const next = Math.max(top[0].next, config.uidBase);
    if (next > lastSandboxUid(config)) throw new SandboxUidExhaustedError(config);

    await client.query("UPDATE users SET sandbox_uid = $1 WHERE id = $2", [next, userId]);
    await client.query(
      `INSERT INTO sandbox_uid_highwater (uid_base, last_uid) VALUES ($1, $2)
       ON CONFLICT (uid_base) DO UPDATE SET last_uid = GREATEST(sandbox_uid_highwater.last_uid, EXCLUDED.last_uid)`,
      [config.uidBase, next]
    );
    await client.query("COMMIT");
    known.set(userId, next);
    return next;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Forgets what this process has seen. For tests that rewrite the table underneath it. */
export function forgetSandboxUids(): void {
  known.clear();
}

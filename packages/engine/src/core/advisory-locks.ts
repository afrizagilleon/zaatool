import type { PoolClient } from "pg";

/**
 * The names of every advisory lock this engine takes, in one place.
 *
 * Postgres advisory locks share a single namespace for the whole database, so two
 * features that each invented a key could block — or worse, silently *not* block — one
 * another. A key is a string here and is hashed to the 64-bit number Postgres wants, which
 * keeps the names readable in a `pg_locks` listing's source and makes a collision a
 * deliberate act rather than a coincidence of two magic numbers.
 */
export const LOCK_KEYS = {
  /** One at a time: does this deployed name, trigger slug or id clash with another notebook's? */
  deployedNames: "zaa:deployed-names",
  /** One at a time: is this the first account? */
  firstAccount: "zaa:first-account",
  /**
   * Held *shared* by every running engine and *exclusive* by a key rotation, so a rotation
   * cannot start while any engine is up and an engine cannot start during one.
   */
  engineAlive: "zaa:engine-alive",
} as const;

/** The per-notebook key: deploys, undeploys and deletes of one notebook queue behind each other. */
export function notebookLockKey(notebookId: string): string {
  return `zaa:notebook:${notebookId}`;
}

/**
 * Waits for the lock and holds it until the surrounding transaction ends.
 *
 * `xact` locks are released by COMMIT or ROLLBACK and by nothing else, which is why they
 * are the ones used around data: a code path that throws cannot leave one behind.
 */
export async function lockUntilTransactionEnds(client: PoolClient, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

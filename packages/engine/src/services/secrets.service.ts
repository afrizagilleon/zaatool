import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import { secretsKey } from "../config.js";
import { decryptValue, encryptValue, isEncrypted } from "../core/secrets-crypto.js";
import { LOCK_KEYS } from "../core/advisory-locks.js";
import { audit } from "./audit.service.js";

/**
 * A secret as the audit trail names it: its key and its owner, never its value. The name of
 * a variable is something an owner is entitled to see a history of; what it holds is not
 * something any log may carry.
 */
function secretTarget(ownerId: string, id: string, key: string) {
  return { type: "secret", id, ownerId, name: key };
}
import { notebookRunsService } from "./notebook-runs.service.js";
import { logger } from "../core/logger.js";

/** The key does not open what the database holds. Never "fixed" by overwriting. */
export class SecretsKeyMismatchError extends Error {
  /** The rows the key could not open, by id: enough to find them, never what they hold. */
  readonly failedIds: string[];

  constructor(failedIds: string[] = []) {
    super(
      failedIds.length === 0
        ? "SECRETS_KEY tidak cocok dengan secret di database"
        : `SECRETS_KEY tidak cocok dengan secret di database (${failedIds.length} baris tidak bisa dibuka: ${failedIds.join(", ")})`
    );
    this.name = "SecretsKeyMismatchError";
    this.failedIds = failedIds;
  }
}

/** A rotation was asked for while an engine (or another rotation) holds the database. */
export class EngineRunningError extends Error {
  constructor() {
    super(
      "The engine is running (or another rotation is), and re-encrypting secrets under it would break it: " +
        "it keeps the old key in memory and would seal every new secret with a key the database no longer matches. " +
        "Stop the engine first (docker compose stop engine), rotate, put the new key in .env, then start it again."
    );
    this.name = "EngineRunningError";
  }
}

interface SecretRow {
  id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
}

/**
 * What is written for a value. With no `SECRETS_KEY` (development only — production refuses
 * to start without one) it is the plaintext, as before.
 */
export function sealSecret(ownerId: string, key: string, value: string): string {
  const k = secretsKey();
  // A body with no value is the database's to refuse (NOT NULL), as it always was.
  if (value === undefined || value === null) return value;
  return k ? encryptValue(k, ownerId, key, String(value)) : value;
}

/** The plaintext of a stored value. A value from before encryption existed is returned as it is. */
export function openSecret(ownerId: string, key: string, stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const k = secretsKey();
  if (!k) throw new Error(`Secret "${key}" is encrypted but SECRETS_KEY is not set.`);
  return decryptValue(k, ownerId, key, stored);
}

/** The shape the API has always returned: a secret's value is never sent back. */
function present(ownerId: string, row: SecretRow) {
  return {
    id: row.id,
    key: row.key,
    is_secret: row.is_secret,
    created_at: row.created_at,
    value: row.is_secret ? "******" : openSecret(ownerId, row.key, row.value),
  };
}

/**
 * A secret belongs to the account that made it, and every method here is asked on behalf of
 * one. Whose secrets a run receives is decided by the execution service (`secretHolderFor`):
 * the owner's for a draft run the owner starts, *the deployer's* for production runs of the
 * deployed version — deploy is the human-approved gate, so the secrets are those of whoever
 * approved that code — and *the starter's own* for anybody else's run of the draft. An
 * editor's code runs with the editor's secrets of the same names, never the owner's. Code in
 * a cell can print or send anything it is given, so handing an editor the owner's credentials
 * would be handing them over; this is what keeps that from happening.
 *
 * Values are encrypted in the database (see `core/secrets-crypto`): every read decrypts and
 * every write encrypts, and nothing outside this file sees the stored form.
 */
export class SecretsService {
  async getAll(ownerId: string) {
    const { rows } = await pool.query<SecretRow>(
      "SELECT id, key, value, is_secret, created_at FROM secrets WHERE owner_id = $1 ORDER BY created_at DESC",
      [ownerId]
    );
    return rows.map((row) => present(ownerId, row));
  }

  /**
   * Resolves only the named secrets.
   *
   * There is deliberately no "give me everything" variant: a code node runs
   * user-authored code and can be reached from a public dashboard, so it must
   * receive the keys it declared and nothing else.
   *
   * `ownerId` null is a notebook nobody owns, which runs with none: there is no one whose
   * credentials it could be borrowing.
   */
  async getByKeys(ownerId: string | null, keys: string[]): Promise<Record<string, string>> {
    return (await this.getForRun(ownerId, keys)).values;
  }

  /**
   * Like `getByKeys`, and also says which of the values are *secret* (not plain variables), so
   * a run knows what to redact from its output: a variable such as a base URL is meant to be
   * readable and redacting it would only mangle the log.
   */
  async getForRun(
    ownerId: string | null,
    keys: string[]
  ): Promise<{ values: Record<string, string>; secret: Record<string, string> }> {
    const values: Record<string, string> = {};
    const secret: Record<string, string> = {};
    if (keys.length === 0 || ownerId === null) return { values, secret };

    const { rows } = await pool.query(
      "SELECT key, value, is_secret FROM secrets WHERE owner_id = $1 AND key = ANY($2)",
      [ownerId, keys]
    );
    for (const row of rows) {
      const plain = openSecret(ownerId, row.key, row.value);
      values[row.key] = plain;
      if (row.is_secret) secret[row.key] = plain;
    }
    return { values, secret };
  }

  async getValueByKey(ownerId: string | null, key: string) {
    if (ownerId === null) return null;
    const { rows } = await pool.query("SELECT value FROM secrets WHERE owner_id = $1 AND key = $2", [
      ownerId,
      key,
    ]);
    if (rows.length === 0) return null;
    return openSecret(ownerId, key, rows[0].value);
  }

  async create(ownerId: string, key: string, value: string, isSecret: boolean) {
    const id = uuidv4();
    const { rows } = await pool.query<SecretRow>(
      "INSERT INTO secrets (id, key, value, is_secret, owner_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, key, value, is_secret, created_at",
      [id, key, sealSecret(ownerId, key, value), isSecret, ownerId]
    );
    await audit.record({
      action: "secret.create",
      target: secretTarget(ownerId, id, key),
      meta: { sensitive: isSecret },
    });
    return present(ownerId, rows[0]);
  }

  /** Undefined when the id is not one of this owner's — which is also when it is not there. */
  async update(ownerId: string, id: string, key: string, value: string, isSecret: boolean) {
    const before = await this.rowOf(ownerId, id);
    const { rows } = await pool.query<SecretRow>(
      "UPDATE secrets SET key = $1, value = $2, is_secret = $3 WHERE id = $4 AND owner_id = $5 RETURNING id, key, value, is_secret, created_at",
      [key, sealSecret(ownerId, key, value), isSecret, id, ownerId]
    );
    if (before && rows[0]) {
      await audit.record({
        action: "secret.update",
        target: secretTarget(ownerId, id, key),
        // Only said when the name changed; whether the *value* did is deliberately not recorded.
        meta: { sensitive: isSecret, ...(before.key !== key ? { renamedFrom: before.key } : {}) },
      });
      const old = openSecret(ownerId, before.key, before.value);
      const now = String(value);
      // The old value is no longer one the owner uses, but runs written while it was current
      // may still hold it; and a plain variable that has just become a secret may already be
      // in history, where nothing hid it.
      if (before.is_secret && old !== now) await this.scrub(ownerId, before.key, old);
      else if (!before.is_secret && isSecret) await this.scrub(ownerId, key, now);
    }
    return rows[0] ? present(ownerId, rows[0]) : undefined;
  }

  async delete(ownerId: string, id: string) {
    const before = await this.rowOf(ownerId, id);
    const { rows } = await pool.query<{ key: string }>(
      "DELETE FROM secrets WHERE id = $1 AND owner_id = $2 RETURNING key",
      [id, ownerId]
    );
    if (rows[0]) await audit.record({ action: "secret.delete", target: secretTarget(ownerId, id, rows[0].key) });
    if (rows[0] && before?.is_secret) await this.scrub(ownerId, before.key, openSecret(ownerId, before.key, before.value));
    return { success: true };
  }

  private async rowOf(ownerId: string, id: string): Promise<SecretRow | undefined> {
    const { rows } = await pool.query<SecretRow>(
      "SELECT id, key, value, is_secret, created_at FROM secrets WHERE id = $1 AND owner_id = $2",
      [id, ownerId]
    );
    return rows[0];
  }

  /**
   * Removes a value that has stopped being current from the stored run history (see
   * `NotebookRunsService.scrubSecret`). It runs inside the request that changed the secret,
   * so by the time the owner is told "saved" the old value is gone from history. A failure is
   * logged and does not undo the change: the secret *has* been rotated, which is what mattered.
   */
  private async scrub(ownerId: string, key: string, value: string): Promise<void> {
    try {
      await notebookRunsService.scrubSecret(ownerId, { [key]: value });
    } catch (err: unknown) {
      logger.error("Could not scrub a changed secret from run history", {
        event: "secrets.scrub_failed",
        err,
        ownerId,
        key,
      });
    }
  }

  /**
   * Run at startup, after `initDb()`. With a key: first proves it opens one encrypted row
   * (a wrong key throws {@link SecretsKeyMismatchError} before anything is written, so an
   * encrypted value is never overwritten), then encrypts every plaintext row in one
   * transaction. Without a key it does nothing. Returns how many rows it encrypted.
   */
  async protectAtStart(): Promise<number> {
    const k = secretsKey();
    if (!k) return 0;

    // Every encrypted row, not a sample. One that opens says nothing about the rest: a row
    // sealed under a different key (a rotation that raced a running engine, a restored
    // backup) sits beside rows that open fine, and would be found later, at the moment a
    // notebook asks for that secret. They are named by id so they can be found.
    const { rows: sealed } = await pool.query<{ id: string; owner_id: string; key: string; value: string }>(
      "SELECT id, owner_id, key, value FROM secrets WHERE value LIKE 'enc:v1:%' AND owner_id IS NOT NULL"
    );
    const failedIds: string[] = [];
    for (const row of sealed) {
      try {
        decryptValue(k, row.owner_id, row.key, row.value);
      } catch {
        failedIds.push(row.id);
      }
    }
    if (failedIds.length > 0) throw new SecretsKeyMismatchError(failedIds);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; owner_id: string; key: string; value: string }>(
        "SELECT id, owner_id, key, value FROM secrets WHERE value NOT LIKE 'enc:v1:%' AND owner_id IS NOT NULL FOR UPDATE"
      );
      for (const row of rows) {
        await client.query("UPDATE secrets SET value = $1 WHERE id = $2", [
          encryptValue(k, row.owner_id, row.key, row.value),
          row.id,
        ]);
      }
      await client.query("COMMIT");
      return rows.length;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Re-encrypts every row from `oldKey` to `newKey` in one transaction: all or none. A row
   * the old key cannot open aborts the whole thing. Plaintext rows are encrypted too.
   */
  async rotateKey(oldKey: Buffer, newKey: Buffer): Promise<number> {
    const client = await pool.connect();
    // Taken on the connection that does the work and held until it is done: the engine holds
    // the shared form of this lock for as long as it lives, so this is refused while one is
    // running, and an engine started meanwhile is refused in turn.
    const { rows: lock } = await client.query<{ got: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS got",
      [LOCK_KEYS.engineAlive]
    );
    if (!lock[0]?.got) {
      client.release();
      throw new EngineRunningError();
    }
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; owner_id: string | null; key: string; value: string }>(
        "SELECT id, owner_id, key, value FROM secrets FOR UPDATE"
      );
      for (const row of rows) {
        // Nobody's secret can be read by anyone, and the AAD needs an owner: left as it is.
        if (row.owner_id === null) continue;
        let plain: string;
        try {
          plain = decryptValue(oldKey, row.owner_id, row.key, row.value);
        } catch {
          throw new Error(
            `The old SECRETS_KEY cannot open secret "${row.key}" (id ${row.id}); nothing was changed.`
          );
        }
        await client.query("UPDATE secrets SET value = $1 WHERE id = $2", [
          encryptValue(newKey, row.owner_id, row.key, plain),
          row.id,
        ]);
      }
      await client.query("COMMIT");
      // Neither key, only that it happened and how many rows it touched.
      await audit.record({ action: "secrets_key.rotate", target: { type: "secrets_key" }, meta: { rows: rows.length } });
      return rows.length;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEYS.engineAlive])
        .catch(() => undefined);
      client.release();
    }
  }
}

export const secretsService = new SecretsService();

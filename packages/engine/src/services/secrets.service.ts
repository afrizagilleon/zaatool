import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import { secretsKey } from "../config.js";
import { decryptValue, encryptValue, isEncrypted } from "../core/secrets-crypto.js";

/** The key does not open what the database holds. Never "fixed" by overwriting. */
export class SecretsKeyMismatchError extends Error {
  constructor() {
    super("SECRETS_KEY tidak cocok dengan secret di database");
    this.name = "SecretsKeyMismatchError";
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
 * one. A notebook runs with its *owner's* secrets — whoever presses Run, whoever edits it —
 * so an editor can write code that uses the owner's credentials, and cannot read them, list
 * them, or use them anywhere else.
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
    if (keys.length === 0 || ownerId === null) return {};

    const { rows } = await pool.query(
      "SELECT key, value FROM secrets WHERE owner_id = $1 AND key = ANY($2)",
      [ownerId, keys]
    );
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = openSecret(ownerId, row.key, row.value);
    }
    return result;
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
    return present(ownerId, rows[0]);
  }

  /** Undefined when the id is not one of this owner's — which is also when it is not there. */
  async update(ownerId: string, id: string, key: string, value: string, isSecret: boolean) {
    const { rows } = await pool.query<SecretRow>(
      "UPDATE secrets SET key = $1, value = $2, is_secret = $3 WHERE id = $4 AND owner_id = $5 RETURNING id, key, value, is_secret, created_at",
      [key, sealSecret(ownerId, key, value), isSecret, id, ownerId]
    );
    return rows[0] ? present(ownerId, rows[0]) : undefined;
  }

  async delete(ownerId: string, id: string) {
    await pool.query("DELETE FROM secrets WHERE id = $1 AND owner_id = $2", [id, ownerId]);
    return { success: true };
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

    const { rows: sample } = await pool.query<{ owner_id: string; key: string; value: string }>(
      "SELECT owner_id, key, value FROM secrets WHERE value LIKE 'enc:v1:%' AND owner_id IS NOT NULL LIMIT 1"
    );
    if (sample[0]) {
      try {
        decryptValue(k, sample[0].owner_id, sample[0].key, sample[0].value);
      } catch {
        throw new SecretsKeyMismatchError();
      }
    }

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
          throw new Error(`The old SECRETS_KEY cannot open secret "${row.key}"; nothing was changed.`);
        }
        await client.query("UPDATE secrets SET value = $1 WHERE id = $2", [
          encryptValue(newKey, row.owner_id, row.key, plain),
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
}

export const secretsService = new SecretsService();

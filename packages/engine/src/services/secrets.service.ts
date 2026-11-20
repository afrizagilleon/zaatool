import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";

/**
 * A secret belongs to the account that made it, and every method here is asked on behalf of
 * one. A notebook runs with its *owner's* secrets — whoever presses Run, whoever edits it —
 * so an editor can write code that uses the owner's credentials, and cannot read them, list
 * them, or use them anywhere else.
 */
export class SecretsService {
  async getAll(ownerId: string) {
    const { rows } = await pool.query(
      "SELECT id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value FROM secrets WHERE owner_id = $1 ORDER BY created_at DESC",
      [ownerId]
    );
    return rows;
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
      result[row.key] = row.value;
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
    return rows[0].value;
  }

  async create(ownerId: string, key: string, value: string, isSecret: boolean) {
    const id = uuidv4();
    const { rows } = await pool.query(
      "INSERT INTO secrets (id, key, value, is_secret, owner_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value",
      [id, key, value, isSecret, ownerId]
    );
    return rows[0];
  }

  /** Undefined when the id is not one of this owner's — which is also when it is not there. */
  async update(ownerId: string, id: string, key: string, value: string, isSecret: boolean) {
    const { rows } = await pool.query(
      "UPDATE secrets SET key = $1, value = $2, is_secret = $3 WHERE id = $4 AND owner_id = $5 RETURNING id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value",
      [key, value, isSecret, id, ownerId]
    );
    return rows[0];
  }

  async delete(ownerId: string, id: string) {
    await pool.query("DELETE FROM secrets WHERE id = $1 AND owner_id = $2", [id, ownerId]);
    return { success: true };
  }
}

export const secretsService = new SecretsService();

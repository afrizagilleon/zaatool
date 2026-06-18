import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";

export class SecretsService {
  async getAll() {
    const { rows } = await pool.query(
      "SELECT id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value FROM secrets ORDER BY created_at DESC"
    );
    return rows;
  }

  async getRawSecrets(): Promise<Record<string, string>> {
    const { rows } = await pool.query("SELECT key, value FROM secrets");
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async getValueByKey(key: string) {
    const { rows } = await pool.query("SELECT value FROM secrets WHERE key = $1", [key]);
    if (rows.length === 0) return null;
    return rows[0].value;
  }

  async create(key: string, value: string, isSecret: boolean) {
    const id = uuidv4();
    const { rows } = await pool.query(
      "INSERT INTO secrets (id, key, value, is_secret) VALUES ($1, $2, $3, $4) RETURNING id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value",
      [id, key, value, isSecret]
    );
    return rows[0];
  }

  async update(id: string, key: string, value: string, isSecret: boolean) {
    const { rows } = await pool.query(
      "UPDATE secrets SET key = $1, value = $2, is_secret = $3 WHERE id = $4 RETURNING id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value",
      [key, value, isSecret, id]
    );
    return rows[0];
  }

  async delete(id: string) {
    await pool.query("DELETE FROM secrets WHERE id = $1", [id]);
    return { success: true };
  }
}

export const secretsService = new SecretsService();

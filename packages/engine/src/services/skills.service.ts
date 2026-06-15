import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";

export class SkillsService {
  async getAll() {
    const { rows } = await pool.query("SELECT * FROM skills ORDER BY created_at DESC");
    return rows;
  }

  async create(name: string, description: string | undefined, content: string | undefined) {
    const id = uuidv4();
    const { rows } = await pool.query(
      "INSERT INTO skills (id, name, description, content) VALUES ($1, $2, $3, $4) RETURNING *",
      [id, name, description || "", content || ""]
    );
    return rows[0];
  }

  async update(id: string, name: string, description: string | undefined, content: string) {
    const { rows } = await pool.query(
      "UPDATE skills SET name = $1, description = $2, content = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *",
      [name, description || "", content, id]
    );
    return rows[0];
  }

  async delete(id: string) {
    await pool.query("DELETE FROM skills WHERE id = $1", [id]);
    return { success: true };
  }
}

export const skillsService = new SkillsService();

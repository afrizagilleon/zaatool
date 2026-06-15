import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";

export class FlowsService {
  async getAll() {
    const result = await pool.query("SELECT * FROM flows ORDER BY updated_at DESC");
    return result.rows;
  }

  async getSummary() {
    const { rows } = await pool.query("SELECT id, name, created_at, updated_at FROM flows ORDER BY updated_at DESC");
    return rows;
  }

  async getById(id: string) {
    const { rows } = await pool.query("SELECT * FROM flows WHERE id = $1", [id]);
    if (rows.length === 0) return null;
    return rows[0];
  }

  async save(id: string | undefined, name: string | undefined, graphJson: any) {
    const flowId = id || uuidv4();
    const flowName = name || "Untitled Flow";
    const jsonStr = typeof graphJson === "string" ? graphJson : JSON.stringify(graphJson);

    await pool.query(
      `INSERT INTO flows (id, name, graph_json) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE 
       SET name = EXCLUDED.name, graph_json = EXCLUDED.graph_json, updated_at = CURRENT_TIMESTAMP`,
      [flowId, flowName, jsonStr]
    );

    return { success: true, id: flowId, name: flowName };
  }

  async delete(id: string) {
    await pool.query("DELETE FROM flows WHERE id = $1", [id]);
    return { success: true };
  }
}

export const flowsService = new FlowsService();

import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

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

  async save(id: string | undefined, name: string | undefined, graphJson: any, dashboardLayout?: string, dashboardPassword?: string) {
    const flowId = id || uuidv4();
    const flowName = name || "Untitled Flow";
    const jsonStr = typeof graphJson === "string" ? graphJson : JSON.stringify(graphJson);

    // Get current flow to check hash
    const { rows } = await pool.query("SELECT dashboard_password_hash FROM flows WHERE id = $1", [flowId]);
    const currentHash = rows.length > 0 ? rows[0].dashboard_password_hash : null;

    let nextHash = currentHash;
    if (dashboardPassword !== undefined) {
      if (dashboardPassword === "[UNCHANGED]") {
        nextHash = currentHash;
      } else if (!dashboardPassword) {
        nextHash = null;
      } else {
        nextHash = await bcrypt.hash(dashboardPassword, 10);
      }
    }

    const layoutValue = dashboardLayout !== undefined ? dashboardLayout : null;

    await pool.query(
      `INSERT INTO flows (id, name, graph_json, dashboard_layout, dashboard_password_hash) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (id) DO UPDATE 
       SET name = EXCLUDED.name, 
           graph_json = EXCLUDED.graph_json, 
           dashboard_layout = COALESCE(EXCLUDED.dashboard_layout, flows.dashboard_layout), 
           dashboard_password_hash = EXCLUDED.dashboard_password_hash, 
           updated_at = CURRENT_TIMESTAMP`,
      [flowId, flowName, jsonStr, layoutValue, nextHash]
    );

    return { success: true, id: flowId, name: flowName };
  }

  async delete(id: string) {
    await pool.query("DELETE FROM flows WHERE id = $1", [id]);
    return { success: true };
  }
}

export const flowsService = new FlowsService();

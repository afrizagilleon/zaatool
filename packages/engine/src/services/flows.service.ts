import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import { dashboardPasswordService } from "./dashboard-password.service.js";
import type { GraphJson, DashboardLayout } from "@zaa-tool/shared";

export interface FlowRecord {
  id: string;
  name: string;
  graph_json: string;
  dashboard_layout: string | null;
  dashboard_password_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FlowSummary {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export class FlowsService {
  async getAll(): Promise<FlowRecord[]> {
    const result = await pool.query("SELECT * FROM flows ORDER BY updated_at DESC");
    return result.rows;
  }

  async getSummary(): Promise<FlowSummary[]> {
    const { rows } = await pool.query(
      "SELECT id, name, created_at, updated_at FROM flows ORDER BY updated_at DESC"
    );
    return rows;
  }

  async getById(id: string): Promise<FlowRecord | null> {
    const { rows } = await pool.query("SELECT * FROM flows WHERE id = $1", [id]);
    if (rows.length === 0) return null;
    return rows[0];
  }

  async save(
    id: string | undefined,
    name: string | undefined,
    graphJson: GraphJson | string,
    dashboardLayout?: DashboardLayout | string,
    dashboardPassword?: string
  ): Promise<{ success: boolean; id: string; name: string }> {
    const flowId = id || uuidv4();
    const flowName = name || "Untitled Flow";
    const jsonStr = typeof graphJson === "string" ? graphJson : JSON.stringify(graphJson);

    const { rows } = await pool.query(
      "SELECT dashboard_password_hash FROM flows WHERE id = $1",
      [flowId]
    );
    const currentHash: string | null = rows.length > 0 ? rows[0].dashboard_password_hash : null;
    const nextHash = await dashboardPasswordService.resolveNextHash(dashboardPassword, currentHash);

    const layoutValue =
      dashboardLayout !== undefined
        ? typeof dashboardLayout === "string"
          ? dashboardLayout
          : JSON.stringify(dashboardLayout)
        : null;

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

  async delete(id: string): Promise<{ success: boolean }> {
    await pool.query("DELETE FROM flows WHERE id = $1", [id]);
    return { success: true };
  }

  parseFlow(flow: FlowRecord): { graph_json: GraphJson; dashboard_layout: DashboardLayout } {
    const graph_json: GraphJson =
      typeof flow.graph_json === "string" ? JSON.parse(flow.graph_json) : flow.graph_json;
    const dashboard_layout: DashboardLayout = flow.dashboard_layout
      ? typeof flow.dashboard_layout === "string"
        ? JSON.parse(flow.dashboard_layout)
        : flow.dashboard_layout
      : { items: [] };
    return { graph_json, dashboard_layout };
  }
}

export const flowsService = new FlowsService();

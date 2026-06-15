import { Request, Response } from "express";
import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";

export class TriggersController {
  async getByFlowId(req: Request, res: Response) {
    try {
      const { flowId } = req.params;
      const { rows } = await pool.query(
        "SELECT * FROM triggers WHERE flow_id = $1 ORDER BY created_at DESC",
        [flowId]
      );
      res.json(
        rows.map((r) => ({
          ...r,
          config: typeof r.config === "string" ? JSON.parse(r.config) : r.config,
        }))
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async save(req: Request, res: Response) {
    try {
      const { id, flow_id, type, config, enabled } = req.body;
      if (!flow_id || !type) {
        return res.status(400).json({ error: "flow_id and type are required" });
      }
      const triggerId = id || uuidv4();
      const configStr = typeof config === "string" ? config : JSON.stringify(config || {});
      const isEnabled = enabled !== undefined ? Boolean(enabled) : true;

      await pool.query(
        `INSERT INTO triggers (id, flow_id, type, config, enabled) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (id) DO UPDATE 
         SET type = EXCLUDED.type, config = EXCLUDED.config, enabled = EXCLUDED.enabled`,
        [triggerId, flow_id, type, configStr, isEnabled]
      );

      res.json({ success: true, id: triggerId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await pool.query("DELETE FROM triggers WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}

export const triggersController = new TriggersController();

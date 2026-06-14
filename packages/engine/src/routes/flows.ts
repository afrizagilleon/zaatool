import { Router } from "express";
import { pool } from "../db/database.js";
import { v4 as uuidv4 } from "uuid";

export const flowsRouter = Router();

flowsRouter.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM flows ORDER BY updated_at DESC");
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

flowsRouter.post("/", async (req, res) => {
  try {
    const { id, name, graph_json } = req.body;
    const flowId = id || uuidv4();
    const flowName = name || 'Untitled Flow';
    const jsonStr = typeof graph_json === 'string' ? graph_json : JSON.stringify(graph_json);

    await pool.query(
      `INSERT INTO flows (id, name, graph_json) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE 
       SET name = EXCLUDED.name, graph_json = EXCLUDED.graph_json, updated_at = CURRENT_TIMESTAMP`,
      [flowId, flowName, jsonStr]
    );

    res.json({ success: true, id: flowId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

flowsRouter.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM flows WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

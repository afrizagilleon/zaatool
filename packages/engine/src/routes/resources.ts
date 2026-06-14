import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db/database.js";

const router = Router();

// --- Skills ---
router.get("/skills", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM skills ORDER BY created_at DESC");
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/skills", async (req, res) => {
  try {
    const { name, content } = req.body;
    const id = uuidv4();
    const { rows } = await pool.query(
      "INSERT INTO skills (id, name, content) VALUES ($1, $2, $3) RETURNING *",
      [id, name, content || ""]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/skills/:id", async (req, res) => {
  try {
    const { name, content } = req.body;
    const { rows } = await pool.query(
      "UPDATE skills SET name = $1, content = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
      [name, content, req.params.id]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/skills/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM skills WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Secrets ---
router.get("/secrets", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value FROM secrets ORDER BY created_at DESC");
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/secrets", async (req, res) => {
  try {
    const { key, value, is_secret } = req.body;
    const id = uuidv4();
    const { rows } = await pool.query(
      "INSERT INTO secrets (id, key, value, is_secret) VALUES ($1, $2, $3, $4) RETURNING id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value",
      [id, key, value, Boolean(is_secret)]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/secrets/:id", async (req, res) => {
  try {
    const { key, value, is_secret } = req.body;
    // Note: If updating a secret and value is empty/null, we might want to skip updating the value, but for now we assume client sends full value.
    const { rows } = await pool.query(
      "UPDATE secrets SET key = $1, value = $2, is_secret = $3 WHERE id = $4 RETURNING id, key, is_secret, created_at, CASE WHEN is_secret THEN '******' ELSE value END as value",
      [key, value, Boolean(is_secret), req.params.id]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/secrets/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM secrets WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Flows ---
router.get("/flows", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, created_at, updated_at FROM flows ORDER BY updated_at DESC");
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/flows", async (req, res) => {
  try {
    const { id, name, graph_json } = req.body;
    const flowId = id || uuidv4();
    
    // Upsert
    const { rows } = await pool.query(
      `INSERT INTO flows (id, name, graph_json) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE 
       SET name = EXCLUDED.name, graph_json = EXCLUDED.graph_json, updated_at = CURRENT_TIMESTAMP 
       RETURNING id, name, created_at, updated_at`,
      [flowId, name, JSON.stringify(graph_json)]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/flows/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM flows WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/flows/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM flows WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export const resourcesRouter = router;

import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db/database.js";
import multer from "multer";
import * as Minio from "minio";

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
  secretKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin'
});

const BUCKET_NAME = 'zaa-files';

// Ensure bucket exists
async function initMinio() {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
    }
  } catch (err) {
    console.error("Failed to init MinIO bucket:", err);
  }
}
initMinio();

const upload = multer({ storage: multer.memoryStorage() });

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
    const { name, description, content } = req.body;
    const id = uuidv4();
    const { rows } = await pool.query(
      "INSERT INTO skills (id, name, description, content) VALUES ($1, $2, $3, $4) RETURNING *",
      [id, name, description || "", content || ""]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/skills/:id", async (req, res) => {
  try {
    const { name, description, content } = req.body;
    const { rows } = await pool.query(
      "UPDATE skills SET name = $1, description = $2, content = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *",
      [name, description || "", content, req.params.id]
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

// --- Files ---
router.get("/files", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM files ORDER BY created_at DESC");
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/files", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }
    
    const file = req.file;
    const id = uuidv4();
    const objectName = `${id}-${file.originalname}`;
    
    await minioClient.putObject(BUCKET_NAME, objectName, file.buffer, file.size, {
      'Content-Type': file.mimetype
    });
    
    const { rows } = await pool.query(
      "INSERT INTO files (id, name, path, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [id, file.originalname, objectName, file.mimetype, file.size]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/files/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT path FROM files WHERE id = $1", [req.params.id]);
    if (rows.length > 0) {
      await minioClient.removeObject(BUCKET_NAME, rows[0].path);
      await pool.query("DELETE FROM files WHERE id = $1", [req.params.id]);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/folders", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Folder name is required" });
    
    // Ensure name ends with /
    const folderName = name.endsWith('/') ? name : name + '/';
    const id = uuidv4();
    
    // Create an empty object in MinIO to represent the folder
    await minioClient.putObject(BUCKET_NAME, folderName, '');
    
    const { rows } = await pool.query(
      "INSERT INTO files (id, name, path, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [id, name, folderName, 'inode/directory', 0]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export const resourcesRouter = router;

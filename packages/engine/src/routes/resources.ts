import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db/database.js";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, "../../storage");

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = req.query.dir ? String(req.query.dir) : '';
    const targetDir = path.join(STORAGE_DIR, dir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

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

// --- Files (Local File System) ---
router.get("/files", (req, res) => {
  try {
    const dir = req.query.dir ? String(req.query.dir) : '';
    const targetPath = path.join(STORAGE_DIR, dir);
    
    if (!fs.existsSync(targetPath)) {
      return res.json([]);
    }

    const items = fs.readdirSync(targetPath, { withFileTypes: true });
    const result = items.map(item => {
      const stats = fs.statSync(path.join(targetPath, item.name));
      return {
        id: Buffer.from(path.join(dir, item.name).replace(/\\/g, '/')).toString('base64'),
        name: item.name,
        path: path.join(dir, item.name).replace(/\\/g, '/'),
        mime_type: item.isDirectory() ? 'inode/directory' : '',
        size_bytes: stats.size,
        created_at: stats.birthtime
      };
    });
    
    // Sort directories first
    result.sort((a, b) => {
      if (a.mime_type === 'inode/directory' && b.mime_type !== 'inode/directory') return -1;
      if (a.mime_type !== 'inode/directory' && b.mime_type === 'inode/directory') return 1;
      return a.name.localeCompare(b.name);
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/files", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }
    
    const dir = req.query.dir ? String(req.query.dir) : '';
    const itemPath = path.join(dir, req.file.originalname).replace(/\\/g, '/');
    const stats = fs.statSync(req.file.path);

    res.json({
      id: Buffer.from(itemPath).toString('base64'),
      name: req.file.originalname,
      path: itemPath,
      mime_type: req.file.mimetype,
      size_bytes: stats.size,
      created_at: stats.birthtime
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/files/:id", (req, res) => {
  try {
    const itemPath = Buffer.from(req.params.id, 'base64').toString('utf-8');
    const fullPath = path.join(STORAGE_DIR, itemPath);
    
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/folders", (req, res) => {
  try {
    const { name, dir } = req.body;
    if (!name) return res.status(400).json({ error: "Folder name is required" });
    
    const currentDir = dir ? String(dir) : '';
    const folderPath = path.join(STORAGE_DIR, currentDir, name);
    
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    
    const itemPath = path.join(currentDir, name).replace(/\\/g, '/');
    const stats = fs.statSync(folderPath);

    res.json({
      id: Buffer.from(itemPath).toString('base64'),
      name: name,
      path: itemPath,
      mime_type: 'inode/directory',
      size_bytes: stats.size,
      created_at: stats.birthtime
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export const resourcesRouter = router;

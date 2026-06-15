import { Request, Response } from "express";
import { storageService } from "../services/storage.service.js";
import fs from "fs";

export class StorageController {
  getAll(req: Request, res: Response) {
    try {
      const dir = req.query.dir ? String(req.query.dir) : "";
      const items = storageService.listItems(dir);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  uploadFile(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const dir = req.query.dir ? String(req.query.dir) : "";
      const filename = req.file.originalname;
      const targetPath = storageService.resolvePath(dir, filename);
      
      // Since multer diskStorage already saved it to destination, we read stats from the saved file path
      const stats = fs.statSync(req.file.path);
      const relativePath = `${dir ? dir + "/" : ""}${filename}`;

      res.json({
        id: Buffer.from(relativePath).toString("base64"),
        name: filename,
        path: relativePath,
        mime_type: req.file.mimetype,
        size_bytes: stats.size,
        created_at: stats.birthtime,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  createFolder(req: Request, res: Response) {
    try {
      const { name, dir } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Folder name is required" });
      }

      const currentDir = dir ? String(dir) : "";
      const result = storageService.createFolder(name, currentDir);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  deleteItem(req: Request, res: Response) {
    try {
      const result = storageService.deleteItem(String(req.params.id));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}

export const storageController = new StorageController();

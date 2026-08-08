import { Request, Response } from "express";
import fs from "fs";
import { storageService, OutsideStorageError } from "../services/storage.service.js";
import { signStorageLink } from "../core/storage-links.js";
import { safeSubPath } from "../core/storage-paths.js";
import { STORAGE_DIR } from "../services/storage.service.js";

/** A refused path is the caller's mistake, not the server's. */
function fail(res: Response, err: unknown) {

  const status = err instanceof OutsideStorageError ? 400 : 500;
  if (status === 500) {
    console.error("Storage controller error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  } else {
    res.status(status).json({ error: (err as Error).message });
  }
}


export class StorageController {
  getAll(req: Request, res: Response) {
    try {
      const dir = req.query.dir ? String(req.query.dir) : "";
      const search = req.query.search ? String(req.query.search) : "";
      const items = search ? storageService.searchItems(search, dir) : storageService.listItems(dir);
      res.json(items);
    } catch (err) {
      fail(res, err);
    }
  }

  uploadFile(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Multer already wrote it, under the name and into the folder the route decided —
      // so the answer describes what is on disk, not what the request asked for.
      const stats = fs.statSync(req.file.path);
      const dir = safeSubPath(req.query.dir, STORAGE_DIR) ?? "";
      const filename = req.file.filename;
      const relativePath = `${dir ? dir + "/" : ""}${filename}`;

      res.json({
        id: Buffer.from(relativePath).toString("base64"),
        name: filename,
        path: relativePath,
        mime_type: req.file.mimetype,
        size_bytes: stats.size,
        created_at: stats.birthtime,
        url: signStorageLink(relativePath),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  createFolder(req: Request, res: Response) {
    try {
      const { name, dir } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Folder name is required" });
      }

      const currentDir = dir ? String(dir) : "";
      res.json(storageService.createFolder(name, currentDir));
    } catch (err) {
      fail(res, err);
    }
  }

  deleteItem(req: Request, res: Response) {
    try {
      res.json(storageService.deleteItem(String(req.params.id)));
    } catch (err) {
      fail(res, err);
    }
  }

  renameItem(req: Request, res: Response) {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: "New name is required" });
      }
      res.json(storageService.renameItem(String(req.params.id), name));
    } catch (err) {
      fail(res, err);
    }
  }
}

export const storageController = new StorageController();

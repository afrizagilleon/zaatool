import { Request, Response } from "express";
import fs from "fs";
import { storageService, OutsideStorageError } from "../services/storage.service.js";
import { signStorageLink } from "../core/storage-links.js";
import { safeSubPath } from "../core/storage-paths.js";
import { STORAGE_DIR } from "../services/storage.service.js";
import { notebookAccessService } from "../services/notebook-access.service.js";

/**
 * Which paths are somebody else's notebook's folders, for the person asking.
 *
 * Only `notebooks/<id>/` and `uploads/<id>/` belong to a notebook. Every other folder in
 * storage is shared among creators, which is how it has always worked and is written down
 * in ARCHITECTURE.md rather than fixed here. A folder hidden from somebody is answered the
 * way a folder that is not there is: empty, or "not found".
 */
async function hiddenFor(req: Request): Promise<(relativePath: string) => boolean> {
  return notebookAccessService.hiddenFromStorage((req as Request & { user: { id: string } }).user.id);
}

/** An item's id is its path, base64 — the form the listing hands out and the client sends back. */
const pathOfId = (id: string): string => Buffer.from(id, "base64").toString("utf-8");

/** A refused path is the caller's mistake, not the server's. */
function fail(res: Response, err: unknown) {
  if (err instanceof OutsideStorageError) {
    return res.status(400).json({ error: err.message });
  }
  console.error("Storage controller error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

export class StorageController {
  async getAll(req: Request, res: Response) {
    try {
      const dir = req.query.dir ? String(req.query.dir) : "";
      const search = req.query.search ? String(req.query.search) : "";
      const hidden = await hiddenFor(req);
      // Looking inside somebody else's notebook folder finds nothing, like a folder that is
      // not there; and whatever a listing or a search turns up from inside one is dropped.
      if (hidden(dir)) return res.json([]);
      const items = search ? storageService.searchItems(search, dir) : storageService.listItems(dir);
      res.json(items.filter((item) => !hidden(item.path)));
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

  async createFolder(req: Request, res: Response) {
    try {
      const { name, dir } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Folder name is required" });
      }

      const currentDir = dir ? String(dir) : "";
      if ((await hiddenFor(req))(currentDir)) return res.status(404).json({ error: "Not found" });
      res.json(storageService.createFolder(name, currentDir));
    } catch (err) {
      fail(res, err);
    }
  }

  async deleteItem(req: Request, res: Response) {
    try {
      if ((await hiddenFor(req))(pathOfId(String(req.params.id)))) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json(storageService.deleteItem(String(req.params.id)));
    } catch (err) {
      fail(res, err);
    }
  }

  async renameItem(req: Request, res: Response) {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: "New name is required" });
      }
      if ((await hiddenFor(req))(pathOfId(String(req.params.id)))) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json(storageService.renameItem(String(req.params.id), name));
    } catch (err) {
      fail(res, err);
    }
  }
}

export const storageController = new StorageController();

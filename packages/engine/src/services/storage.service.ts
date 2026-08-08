import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveInside, safeFilename, safeSubPath } from "../core/storage-paths.js";
import { signStorageLink } from "../core/storage-links.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_DIR = path.resolve(__dirname, "../../../storage");

/**
 * A path that pointed outside the storage folder.
 *
 * Its own type so the controller can answer 400 rather than 500: the request was wrong,
 * not the server. It carries no path back — an attacker learns whether their probe was
 * refused, and nothing about the shape of the disk.
 */
export class OutsideStorageError extends Error {
  constructor() {
    super("That path is outside storage.");
    this.name = "OutsideStorageError";
  }
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".html": "text/html",
  ".css": "text/css",
  ".zip": "application/zip",
};

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

type StorageItem = {
  id: string;
  name: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  created_at: Date;
  /** Signed, time-limited, and absent for folders. See `core/storage-links.ts`. */
  url?: string;
};

function sortItems(items: StorageItem[]) {
  items.sort((a, b) => {
    if (a.mime_type === "inode/directory" && b.mime_type !== "inode/directory") return -1;
    if (a.mime_type !== "inode/directory" && b.mime_type === "inode/directory") return 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

/** Every path from outside passes through here before it reaches the filesystem. */
function inside(raw: unknown): string {
  const relative = safeSubPath(raw, STORAGE_DIR);
  if (relative === null) throw new OutsideStorageError();
  return relative;
}

import { maxNotebookStorageBytes } from "../config.js";
import { getFolderSizeRecursive } from "./notebook-files.service.js";

function checkPathQuota(targetDir: string, additionalBytes = 0): void {
  const relative = safeSubPath(targetDir, STORAGE_DIR);
  if (!relative) return;
  const parts = relative.replace(/\\/g, "/").split("/");
  if (parts[0] === "uploads" && parts[1]) {
    const notebookFolder = path.join(STORAGE_DIR, "uploads", parts[1]);
    const currentSize = getFolderSizeRecursive(notebookFolder);
    if (currentSize + additionalBytes > maxNotebookStorageBytes()) {
      const maxMb = Math.round(maxNotebookStorageBytes() / (1024 * 1024));
      throw new Error(
        `Notebook storage limit of ${maxMb} MB reached. Increase MAX_NOTEBOOK_STORAGE_MB if needed.`
      );
    }
  }
}

export class StorageService {
  constructor() {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
  }

  /** The absolute path to write to, with the folder made if it is missing. */
  resolvePath(subDir: string, filename = "") {
    const targetDir = resolveInside(subDir, STORAGE_DIR);
    if (targetDir === null) throw new OutsideStorageError();
    checkPathQuota(targetDir, 0);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    return path.join(targetDir, safeFilename(filename));
  }


  private toStorageItem(relativePath: string, isDirectory: boolean, stats: fs.Stats): StorageItem {
    return {
      id: Buffer.from(relativePath).toString("base64"),
      name: path.basename(relativePath),
      path: relativePath,
      mime_type: isDirectory ? "inode/directory" : getMimeType(relativePath),
      size_bytes: stats.size,
      created_at: stats.birthtime,
      ...(isDirectory ? {} : { url: signStorageLink(relativePath) }),
    };
  }

  listItems(dir: string) {
    const relative = inside(dir);
    const targetPath = path.join(STORAGE_DIR, relative);
    if (!fs.existsSync(targetPath)) {
      return [];
    }

    const items = fs.readdirSync(targetPath, { withFileTypes: true });
    const result = items.map((item) => {
      const itemFullPath = path.join(targetPath, item.name);
      const stats = fs.statSync(itemFullPath);
      const relativeItemPath = path.join(relative, item.name).replace(/\\/g, "/");
      return this.toStorageItem(relativeItemPath, item.isDirectory(), stats);
    });

    return sortItems(result);
  }

  searchItems(query: string, dir: string = "") {
    const root = inside(dir);
    const targetPath = path.join(STORAGE_DIR, root);
    if (!fs.existsSync(targetPath)) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    const results: StorageItem[] = [];

    const walk = (currentDir: string) => {
      const absoluteDir = path.join(STORAGE_DIR, currentDir);
      const items = fs.readdirSync(absoluteDir, { withFileTypes: true });
      for (const item of items) {
        const relativePath = path.join(currentDir, item.name).replace(/\\/g, "/");
        const isDirectory = item.isDirectory();
        if (item.name.toLowerCase().includes(lowerQuery)) {
          const stats = fs.statSync(path.join(STORAGE_DIR, relativePath));
          results.push(this.toStorageItem(relativePath, isDirectory, stats));
        }
        if (isDirectory) {
          walk(relativePath);
        }
      }
    };

    walk(root);

    return sortItems(results);
  }

  createFolder(name: string, dir: string) {
    const parent = inside(dir);
    const folderName = safeFilename(name);
    const folderPath = path.join(STORAGE_DIR, parent, folderName);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const relativePath = path.join(parent, folderName).replace(/\\/g, "/");
    const stats = fs.statSync(folderPath);

    return this.toStorageItem(relativePath, true, stats);
  }

  renameItem(base64Id: string, newName: string) {
    // The id is a path the client sends back, so it is input like any other.
    const relativePath = inside(Buffer.from(base64Id, "base64").toString("utf-8"));
    if (relativePath === "") throw new OutsideStorageError();

    const oldFullPath = path.join(STORAGE_DIR, relativePath);
    if (!fs.existsSync(oldFullPath)) {
      throw new Error("Item not found");
    }

    const parentDir = path.dirname(relativePath);
    const cleanName = safeFilename(newName);
    const newRelativePath = (parentDir === "." ? cleanName : path.join(parentDir, cleanName)).replace(
      /\\/g,
      "/"
    );
    const newFullPath = path.join(STORAGE_DIR, newRelativePath);

    fs.renameSync(oldFullPath, newFullPath);

    const stats = fs.statSync(newFullPath);
    return this.toStorageItem(newRelativePath, stats.isDirectory(), stats);
  }

  deleteItem(base64Id: string) {
    const relativePath = inside(Buffer.from(base64Id, "base64").toString("utf-8"));
    // An empty path is the storage root itself, and no request gets to delete that.
    if (relativePath === "") throw new OutsideStorageError();

    const fullPath = path.join(STORAGE_DIR, relativePath);

    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
    return { success: true };
  }
}

export const storageService = new StorageService();

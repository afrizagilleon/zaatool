import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_DIR = path.resolve(__dirname, "../../../storage");

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
};

function sortItems(items: StorageItem[]) {
  items.sort((a, b) => {
    if (a.mime_type === "inode/directory" && b.mime_type !== "inode/directory") return -1;
    if (a.mime_type !== "inode/directory" && b.mime_type === "inode/directory") return 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

export class StorageService {
  constructor() {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
  }

  resolvePath(subDir: string, filename = "") {
    const targetDir = path.join(STORAGE_DIR, subDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    return path.join(targetDir, filename);
  }

  private toStorageItem(relativePath: string, isDirectory: boolean, stats: fs.Stats): StorageItem {
    return {
      id: Buffer.from(relativePath).toString("base64"),
      name: path.basename(relativePath),
      path: relativePath,
      mime_type: isDirectory ? "inode/directory" : getMimeType(relativePath),
      size_bytes: stats.size,
      created_at: stats.birthtime,
    };
  }

  listItems(dir: string) {
    const targetPath = path.join(STORAGE_DIR, dir);
    if (!fs.existsSync(targetPath)) {
      return [];
    }

    const items = fs.readdirSync(targetPath, { withFileTypes: true });
    const result = items.map((item) => {
      const itemFullPath = path.join(targetPath, item.name);
      const stats = fs.statSync(itemFullPath);
      const relativePath = path.join(dir, item.name).replace(/\\/g, "/");
      return this.toStorageItem(relativePath, item.isDirectory(), stats);
    });

    return sortItems(result);
  }

  searchItems(query: string, dir: string = "") {
    const targetPath = path.join(STORAGE_DIR, dir);
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

    walk(dir);

    return sortItems(results);
  }

  createFolder(name: string, dir: string) {
    const folderPath = path.join(STORAGE_DIR, dir, name);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const relativePath = path.join(dir, name).replace(/\\/g, "/");
    const stats = fs.statSync(folderPath);

    return this.toStorageItem(relativePath, true, stats);
  }

  renameItem(base64Id: string, newName: string) {
    const relativePath = Buffer.from(base64Id, "base64").toString("utf-8");
    const oldFullPath = path.join(STORAGE_DIR, relativePath);
    if (!fs.existsSync(oldFullPath)) {
      throw new Error("Item not found");
    }

    const parentDir = path.dirname(relativePath);
    const newRelativePath = (parentDir === "." ? newName : path.join(parentDir, newName)).replace(/\\/g, "/");
    const newFullPath = path.join(STORAGE_DIR, newRelativePath);

    fs.renameSync(oldFullPath, newFullPath);

    const stats = fs.statSync(newFullPath);
    return this.toStorageItem(newRelativePath, stats.isDirectory(), stats);
  }

  deleteItem(base64Id: string) {
    const relativePath = Buffer.from(base64Id, "base64").toString("utf-8");
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

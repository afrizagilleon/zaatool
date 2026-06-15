import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_DIR = path.resolve(__dirname, "../../../storage");

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
      return {
        id: Buffer.from(relativePath).toString("base64"),
        name: item.name,
        path: relativePath,
        mime_type: item.isDirectory() ? "inode/directory" : "",
        size_bytes: stats.size,
        created_at: stats.birthtime,
      };
    });

    // Sort directories first, then alphabetically
    result.sort((a, b) => {
      if (a.mime_type === "inode/directory" && b.mime_type !== "inode/directory") return -1;
      if (a.mime_type !== "inode/directory" && b.mime_type === "inode/directory") return 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  createFolder(name: string, dir: string) {
    const folderPath = path.join(STORAGE_DIR, dir, name);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const relativePath = path.join(dir, name).replace(/\\/g, "/");
    const stats = fs.statSync(folderPath);

    return {
      id: Buffer.from(relativePath).toString("base64"),
      name: name,
      path: relativePath,
      mime_type: "inode/directory",
      size_bytes: stats.size,
      created_at: stats.birthtime,
    };
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

import fs from "fs";
import nodePath from "path";

/**
 * Storage root the engine handed this worker. FileObject derives what it reads from
 * `path` and this root; it never trusts an `absolute_path` that arrived as data.
 */
let storageRoot = "";
export function setStorageRoot(root: string): void {
  storageRoot = typeof root === "string" ? nodePath.resolve(root) : "";
}

export class Table {
  public rows: any[];

  constructor(rows: any[]) {
    this.rows = Array.isArray(rows) ? rows : [];
  }

  getRows() {
    return this.rows;
  }

  getRow(index: number) {
    return this.rows[index] || null;
  }

  getHeaders() {
    if (this.rows.length === 0) return [];
    return Object.keys(this.rows[0]);
  }

  getColumn(columnKey: string) {
    return this.rows.map(row => row[columnKey]);
  }

  getCell(rowIndex: number, columnKey: string) {
    const row = this.getRow(rowIndex);
    return row ? row[columnKey] : null;
  }

  filter(callback: (row: any) => boolean) {
    return new Table(this.rows.filter(callback));
  }

  map<T>(callback: (row: any, index: number) => T) {
    return this.rows.map(callback);
  }

  count() {
    return this.rows.length;
  }

  toJSON() {
    return this.rows;
  }
}

export class FileObject {
  public name: string;
  public path: string;
  public url: string;
  public absolute_path: string;

  constructor(fileData: any) {
    this.name = fileData?.name || "";
    this.path = fileData?.path || "";
    this.url = fileData?.url || "";
    this.absolute_path = this.derive(fileData?.path);
  }

  private derive(rel: unknown): string {
    if (!storageRoot || typeof rel !== "string" || rel.trim() === "") return "";
    const stripped = rel.trim().replace(/^[/\\]+/, "");
    if (!stripped || nodePath.isAbsolute(stripped)) return "";
    const resolved = nodePath.resolve(storageRoot, stripped);
    return resolved.startsWith(storageRoot + nodePath.sep) ? resolved : "";
  }

  readAsText() {
    if (!this.absolute_path || !fs.existsSync(this.absolute_path)) return "";
    return fs.readFileSync(this.absolute_path, "utf-8");
  }

  readAsBase64() {
    if (!this.absolute_path || !fs.existsSync(this.absolute_path)) return "";
    return fs.readFileSync(this.absolute_path, "base64");
  }

  readAsBuffer() {
    if (!this.absolute_path || !fs.existsSync(this.absolute_path)) return null;
    return fs.readFileSync(this.absolute_path);
  }

  exists() {
    return !!this.absolute_path && fs.existsSync(this.absolute_path);
  }

  /**
   * `absolute_path` is deliberately absent.
   *
   * It exists so this object can read the file, and it names a folder on the server. A
   * cell that returns the file it was given would otherwise put the engine's disk layout
   * into a page, a webhook's reply and an agent's transcript.
   */
  toJSON() {
    return {
      name: this.name,
      path: this.path,
      url: this.url,
    };
  }
}

export class ImageObject extends FileObject {
  constructor(imageData: any) {
    if (typeof imageData === "string") {
      super({ path: imageData, url: imageData, name: imageData.split("/").pop() });
    } else {
      super(imageData);
    }
  }

  toDataUri(mimeType = "image/jpeg") {
    const base64 = this.readAsBase64();
    if (!base64) return "";
    return `data:${mimeType};base64,${base64}`;
  }
}

import fs from "fs";

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
    this.absolute_path = fileData?.absolute_path || "";
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

  toJSON() {
    return {
      name: this.name,
      path: this.path,
      url: this.url,
      absolute_path: this.absolute_path,
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

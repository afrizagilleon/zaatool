import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import { notebookTriggersService } from "./notebook-triggers.service.js";
import type { NotebookJson, NotebookRuntime, NotebookSummary } from "@zaa-tool/shared";

export interface NotebookRecord {
  id: string;
  name: string;
  runtime: NotebookRuntime;
  document: string;
  created_at: Date;
  updated_at: Date;
}

export class NotebooksService {
  async getSummary(): Promise<NotebookSummary[]> {
    const { rows } = await pool.query(
      "SELECT id, name, runtime, created_at, updated_at FROM notebooks ORDER BY updated_at DESC"
    );
    return rows;
  }

  async getById(id: string): Promise<NotebookRecord | null> {
    const { rows } = await pool.query("SELECT * FROM notebooks WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  async save(document: NotebookJson): Promise<{ id: string; name: string }> {
    const id = document.id || uuidv4();
    const name = document.name || "Untitled Notebook";
    const runtime: NotebookRuntime = document.runtime === "python" ? "python" : "node";
    const stored: NotebookJson = { ...document, id, name, runtime };

    await pool.query(
      `INSERT INTO notebooks (id, name, runtime, document)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           runtime = EXCLUDED.runtime,
           document = EXCLUDED.document,
           updated_at = CURRENT_TIMESTAMP`,
      [id, name, runtime, JSON.stringify(stored)]
    );

    // The document is the source of truth; the trigger index follows it.
    await notebookTriggersService.syncForNotebook(id, stored.triggers ?? []);

    return { id, name };
  }

  async delete(id: string): Promise<{ success: boolean }> {
    await notebookTriggersService.deleteByNotebook(id);
    await pool.query("DELETE FROM notebooks WHERE id = $1", [id]);
    return { success: true };
  }

  parseDocument(record: NotebookRecord): NotebookJson {
    return typeof record.document === "string"
      ? (JSON.parse(record.document) as NotebookJson)
      : (record.document as NotebookJson);
  }
}

export const notebooksService = new NotebooksService();

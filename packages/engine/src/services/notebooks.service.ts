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

  /** Every document at once, for anything that has to look at the whole workspace. */
  async getAllDocuments(): Promise<{ document: NotebookJson; updatedAt: string }[]> {
    const { rows } = await pool.query(
      "SELECT * FROM notebooks ORDER BY updated_at DESC"
    );
    return (rows as NotebookRecord[]).map((row) => ({
      document: this.parseDocument(row),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async getById(id: string): Promise<NotebookRecord | null> {
    const { rows } = await pool.query("SELECT * FROM notebooks WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  /**
   * How `notebooks.run("...")` resolves its argument.
   *
   * An id is stable but unreadable, and a name is readable but not unique, so both
   * are accepted and the id wins. An ambiguous name is refused rather than resolved
   * by recency: silently calling whichever copy was edited last is the kind of bug
   * that only shows up in production.
   */
  async findByIdOrName(reference: string): Promise<NotebookRecord | "ambiguous" | null> {
    const { rows } = await pool.query(
      `SELECT * FROM notebooks WHERE id::text = $1
       UNION ALL
       SELECT * FROM notebooks WHERE name = $1 AND id::text <> $1`,
      [reference]
    );

    if (rows.length === 0) return null;
    if (rows.length > 1) return "ambiguous";
    return rows[0];
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

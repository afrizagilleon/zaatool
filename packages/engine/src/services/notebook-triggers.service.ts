import { pool } from "../db/connection.js";
import type { NotebookTrigger } from "@zaa-tool/shared";

export interface TriggerRecord {
  id: string;
  notebook_id: string;
  kind: "cron" | "webhook";
  cron: string | null;
  slug: string | null;
  secret_key: string | null;
  enabled: boolean;
}

export class NotebookTriggersService {
  /**
   * Mirrors a notebook's declared triggers into the index.
   *
   * Replace-all inside a transaction rather than a diff: the document is the source
   * of truth, so the table simply reflects it and cannot drift. The document passed in
   * is the **deployed** version's, never the draft's: the index is what production
   * listens to, and only a deploy changes production.
   */
  async syncForNotebook(notebookId: string, triggers: NotebookTrigger[] = []): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM notebook_triggers WHERE notebook_id = $1", [notebookId]);

      for (const trigger of triggers) {
        if (trigger.kind === "cron") {
          if (!trigger.cron?.trim()) continue;
          await client.query(
            `INSERT INTO notebook_triggers (id, notebook_id, kind, cron, enabled)
             VALUES ($1, $2, 'cron', $3, $4)`,
            [trigger.id, notebookId, trigger.cron.trim(), trigger.enabled !== false]
          );
          continue;
        }

        if (!trigger.slug?.trim()) continue;
        await client.query(
          `INSERT INTO notebook_triggers (id, notebook_id, kind, slug, secret_key, enabled)
           VALUES ($1, $2, 'webhook', $3, $4, $5)`,
          [
            trigger.id,
            notebookId,
            trigger.slug.trim(),
            trigger.secretKey?.trim() || null,
            trigger.enabled !== false,
          ]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Every enabled cron trigger, for one scheduler tick. */
  async listEnabledCron(): Promise<TriggerRecord[]> {
    const { rows } = await pool.query(
      "SELECT * FROM notebook_triggers WHERE kind = 'cron' AND enabled = TRUE"
    );
    return rows;
  }

  async findEnabledWebhook(slug: string): Promise<TriggerRecord | null> {
    const { rows } = await pool.query(
      "SELECT * FROM notebook_triggers WHERE kind = 'webhook' AND slug = $1 AND enabled = TRUE",
      [slug]
    );
    return rows[0] ?? null;
  }

  async deleteByNotebook(notebookId: string): Promise<void> {
    await pool.query("DELETE FROM notebook_triggers WHERE notebook_id = $1", [notebookId]);
  }
}

export const notebookTriggersService = new NotebookTriggersService();

import { pool } from "../db/connection.js";
import type { NotebookJson, NotebookTrigger } from "@zaa-tool/shared";

export interface TriggerRecord {
  id: string;
  notebook_id: string;
  kind: "cron" | "webhook";
  cron: string | null;
  slug: string | null;
  secret_key: string | null;
  enabled: boolean;
}

/** One thing a rebuild did to the index, worded for a boot log. */
export interface TriggerIndexChange {
  notebookId: string;
  triggerId: string;
  change: "added" | "removed" | "changed" | "skipped";
  detail: string;
}

/**
 * What the index should hold for one notebook's declared triggers.
 *
 * The single definition of which declared triggers become rows — a cron with no schedule
 * and a webhook with no slug are skipped, text is trimmed, `enabled` defaults to on — so
 * a deploy and a rebuild at boot cannot disagree about it.
 */
function rowsFor(notebookId: string, triggers: NotebookTrigger[]): TriggerRecord[] {
  const rows: TriggerRecord[] = [];
  for (const trigger of triggers) {
    if (trigger.kind === "cron") {
      if (!trigger.cron?.trim()) continue;
      rows.push({
        id: trigger.id,
        notebook_id: notebookId,
        kind: "cron",
        cron: trigger.cron.trim(),
        slug: null,
        secret_key: null,
        enabled: trigger.enabled !== false,
      });
      continue;
    }

    if (!trigger.slug?.trim()) continue;
    rows.push({
      id: trigger.id,
      notebook_id: notebookId,
      kind: "webhook",
      cron: null,
      slug: trigger.slug.trim(),
      secret_key: trigger.secretKey?.trim() || null,
      enabled: trigger.enabled !== false,
    });
  }
  return rows;
}

const INSERT_ROW = `INSERT INTO notebook_triggers (id, notebook_id, kind, cron, slug, secret_key, enabled)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)`;

function rowParams(row: TriggerRecord): unknown[] {
  return [row.id, row.notebook_id, row.kind, row.cron, row.slug, row.secret_key, row.enabled];
}

/** How an existing row differs from the one it should be, or null when it does not. */
function describeDifference(before: TriggerRecord, after: TriggerRecord): string | null {
  const differences: string[] = [];
  if (before.notebook_id !== after.notebook_id) differences.push("notebook");
  if (before.kind !== after.kind) differences.push("kind");
  if (before.cron !== after.cron) differences.push(`cron ${before.cron} -> ${after.cron}`);
  if (before.slug !== after.slug) differences.push(`slug ${before.slug} -> ${after.slug}`);
  if (before.secret_key !== after.secret_key) {
    differences.push(`secret ${before.secret_key ?? "none"} -> ${after.secret_key ?? "none"}`);
  }
  if (before.enabled !== after.enabled) differences.push(`enabled ${before.enabled} -> ${after.enabled}`);
  return differences.length > 0 ? differences.join(", ") : null;
}

function parseDocument(raw: unknown): NotebookJson {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as NotebookJson;
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

      for (const row of rowsFor(notebookId, triggers)) {
        await client.query(INSERT_ROW, rowParams(row));
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Writes the whole index again from what is deployed, and says what that changed.
   *
   * For an installation that predates "the index follows the deployed version": its table
   * was written from drafts, so a webhook may be missing the secret its deployed version
   * declares, or a cron that was only ever saved may be firing. Idempotent — a second call
   * finds nothing to change and returns an empty list — which is what lets the server run
   * it on every boot instead of once. A notebook with no deployed version contributes no
   * rows.
   *
   * Everything happens in one transaction, so a failure leaves the index as it was rather
   * than half rebuilt. Two deployed notebooks can declare the same trigger id or slug (ids
   * are only unique within a document; the table's are global): the one deployed earlier
   * keeps it and the other trigger is reported as skipped rather than aborting the boot.
   */
  async rebuildTriggerIndex(): Promise<TriggerIndexChange[]> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: deployed } = await client.query(
        `SELECT n.id AS notebook_id, v.document
         FROM notebooks n
         JOIN notebook_versions v ON v.id = n.deployed_version_id
         ORDER BY v.created_at ASC, n.id ASC`
      );
      const { rows: existing } = await client.query<TriggerRecord>(
        "SELECT id, notebook_id, kind, cron, slug, secret_key, enabled FROM notebook_triggers"
      );
      const before = new Map(existing.map((row) => [row.id, row]));

      await client.query("DELETE FROM notebook_triggers");

      const changes: TriggerIndexChange[] = [];
      const kept = new Set<string>();

      for (const entry of deployed) {
        const notebookId = String(entry.notebook_id);
        const document = parseDocument(entry.document);

        for (const row of rowsFor(notebookId, document.triggers ?? [])) {
          const inserted = await client.query(`${INSERT_ROW} ON CONFLICT DO NOTHING`, rowParams(row));
          if ((inserted.rowCount ?? 0) === 0) {
            changes.push({
              notebookId,
              triggerId: row.id,
              change: "skipped",
              detail: `trigger id "${row.id}" or slug "${row.slug ?? ""}" is already used by another deployed notebook`,
            });
            continue;
          }

          kept.add(row.id);
          const previous = before.get(row.id);
          if (!previous) {
            changes.push({
              notebookId,
              triggerId: row.id,
              change: "added",
              detail: row.kind === "cron" ? `cron ${row.cron}` : `webhook /hooks/${row.slug}`,
            });
            continue;
          }
          const difference = describeDifference(previous, row);
          if (difference) {
            changes.push({ notebookId, triggerId: row.id, change: "changed", detail: difference });
          }
        }
      }

      for (const row of existing) {
        if (kept.has(row.id)) continue;
        changes.push({
          notebookId: row.notebook_id,
          triggerId: row.id,
          change: "removed",
          detail: row.kind === "cron" ? `cron ${row.cron}` : `webhook /hooks/${row.slug}`,
        });
      }

      await client.query("COMMIT");
      return changes;
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

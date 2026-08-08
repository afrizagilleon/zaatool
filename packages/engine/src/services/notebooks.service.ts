import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import { notebookTriggersService } from "./notebook-triggers.service.js";
import { stampAuthors } from "../core/notebook-provenance.js";
import { toolNameFor } from "../core/notebook-tool-name.js";
import { notifyCatalogChanged } from "../core/catalog-events.js";
import { resolvePythonLockedPackages } from "../core/python-runner.js";
import { normaliseTags } from "@zaa-tool/shared";

import type {
  NotebookDeployState,
  NotebookJson,
  NotebookRuntime,
  NotebookSummary,
} from "@zaa-tool/shared";

export interface NotebookRecord {
  id: string;
  name: string;
  runtime: NotebookRuntime;
  document: string;
  created_at: Date;
  updated_at: Date;
}

export class NotebooksService {
  /**
   * Every notebook as a list row, without reading a single document.
   *
   * The list used to know a name and a timestamp, which meant *"which of these is
   * deployed"* could only be answered by opening all of them one at a time. Everything
   * added here is something the list itself has to sort, filter or group by, and each
   * comes from an index rather than from parsing JSON: the deploy pointer, the trigger
   * table, the run table, the tags column.
   *
   * Two lateral joins rather than two grouped joins — each notebook wants its own single
   * most recent run, and `LIMIT 1` inside the lateral is how that stays one row per
   * notebook however long the history gets. Both are covered by indexes that already
   * exist for other reasons (`notebook_runs_notebook_started_idx`,
   * `notebook_triggers_notebook_idx`).
   */
  async getSummary(): Promise<NotebookSummary[]> {
    const { rows } = await pool.query(
      `SELECT n.id, n.name, n.runtime, n.created_at, n.updated_at,
              (n.deployed_version_id IS NOT NULL) AS deployed,
              COALESCE(n.tags, '{}') AS tags,
              last_run.started_at AS last_run_at,
              last_run.status     AS last_run_status,
              COALESCE(kinds.list, '{}') AS trigger_kinds
       FROM notebooks n
       LEFT JOIN LATERAL (
         SELECT started_at, status FROM notebook_runs
         WHERE notebook_id = n.id
         ORDER BY started_at DESC
         LIMIT 1
       ) last_run ON TRUE
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT kind) AS list FROM notebook_triggers
         WHERE notebook_id = n.id AND enabled
       ) kinds ON TRUE
       ORDER BY n.updated_at DESC`
    );
    return rows;
  }

  /** Every document at once, for anything that has to look at the whole workspace. */
  async getAllDocuments(): Promise<
    { document: NotebookJson; updatedAt: string; deployed: boolean }[]
  > {
    const { rows } = await pool.query(
      "SELECT * FROM notebooks ORDER BY updated_at DESC"
    );
    return (rows as (NotebookRecord & { deployed_version_id: string | null })[]).map((row) => ({
      document: this.parseDocument(row),
      updatedAt: new Date(row.updated_at).toISOString(),
      // The map draws it, so it has to travel with the document rather than be a second
      // query the map's caller is expected to remember.
      deployed: row.deployed_version_id !== null,
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

  /**
   * `writer` is who the engine authenticated, not who the request claims to be — it is
   * stamped onto the cells that actually changed, so authorship cannot be forged by
   * sending an `author` field.
   */
  async save(document: NotebookJson, writer = "unknown"): Promise<{ id: string; name: string }> {
    const id = document.id || uuidv4();
    const name = document.name || "Untitled Notebook";
    const runtime: NotebookRuntime = document.runtime === "python" ? "python" : "node";

    const existing = await this.getById(id);
    const stored = stampAuthors(
      existing ? this.parseDocument(existing) : null,
      { ...document, id, name, runtime },
      writer
    );

    // The column is an index of the document, written from it on every save, exactly as
    // the trigger table is. Normalised here as well as in the editor, because an agent
    // writing the text form never passes through the editor.
    const tags = normaliseTags(stored.tags ?? []);

    await pool.query(
      `INSERT INTO notebooks (id, name, runtime, document, tags)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           runtime = EXCLUDED.runtime,
           document = EXCLUDED.document,
           tags = EXCLUDED.tags,
           updated_at = CURRENT_TIMESTAMP`,
      [id, name, runtime, JSON.stringify(stored), tags]
    );

    // The document is the source of truth; the trigger index follows it.
    await notebookTriggersService.syncForNotebook(id, stored.triggers ?? []);

    // Announced here rather than by the caller. There are four ways into this method —
    // the editor, an import, `notebook_write`, `notebook_edit_cell` — and the old
    // arrangement, where each caller remembered, had announced none of them.
    notifyCatalogChanged({ change: "saved", notebookId: id });

    return { id, name };
  }

  /**

   * Pins the current draft as what production runs.
   *
   * The gate this whole thing exists for. Before it, saving was publishing: editing a
   * notebook at 2pm changed what its webhook did at 2:01, which was survivable while
   * only you could edit and became indefensible once an agent could.
   */
  async deploy(id: string, deployedBy: string): Promise<{ versionId: string } | null> {
    const record = await this.getById(id);
    if (!record) return null;

    const doc = this.parseDocument(record);
    let lockedPackages: string[] | null = null;
    if (record.runtime === "python" && Array.isArray(doc.packages) && doc.packages.length > 0) {
      lockedPackages = await resolvePythonLockedPackages(doc.packages);
    }

    const versionId = uuidv4();
    await pool.query(
      `INSERT INTO notebook_versions (id, notebook_id, document, deployed_by, locked_packages)
       VALUES ($1, $2, $3, $4, $5)`,
      [versionId, id, JSON.stringify(doc), deployedBy, lockedPackages]
    );
    await pool.query("UPDATE notebooks SET deployed_version_id = $1 WHERE id = $2", [
      versionId,
      id,
    ]);

    notifyCatalogChanged({ change: "deployed", notebookId: id });
    return { versionId };
  }

  /**
   * Takes a notebook out of production.
   *
   * The version rows stay: they are the record of what ran when, and deleting them to
   * express "not deployed any more" would destroy history to store a boolean. Only the
   * pointer moves, so re-deploying is a decision rather than a recovery.
   */
  async undeploy(id: string): Promise<{ wasDeployed: boolean } | null> {
    const record = await this.getById(id);
    if (!record) return null;

    const { rowCount } = await pool.query(
      "UPDATE notebooks SET deployed_version_id = NULL WHERE id = $1 AND deployed_version_id IS NOT NULL",
      [id]
    );
    const wasDeployed = (rowCount ?? 0) > 0;
    // Only when something actually moved. Announcing an undeploy of a notebook that was
    // never deployed would send every open screen to refetch a list that did not change.
    if (wasDeployed) notifyCatalogChanged({ change: "undeployed", notebookId: id });
    return { wasDeployed };
  }

  /** What a trigger should run, or null when nothing has been deployed yet. */
  async getDeployedDocument(id: string): Promise<NotebookJson | null> {
    const { rows } = await pool.query(
      `SELECT v.document, v.locked_packages
       FROM notebooks n
       JOIN notebook_versions v ON v.id = n.deployed_version_id
       WHERE n.id = $1`,
      [id]
    );
    if (rows.length === 0) return null;
    const doc =
      typeof rows[0].document === "string"
        ? (JSON.parse(rows[0].document) as NotebookJson)
        : (rows[0].document as NotebookJson);

    if (Array.isArray(rows[0].locked_packages) && rows[0].locked_packages.length > 0) {
      doc.packages = rows[0].locked_packages;
    }
    return doc;
  }


  /**
   * Whether a notebook is deployed, and whether the draft has moved on since.
   *
   * The comparison is on the document itself rather than a timestamp: saving without
   * changing anything should not make a notebook look like it needs deploying.
   */
  async getDeployState(id: string): Promise<NotebookDeployState | null> {
    const record = await this.getById(id);
    if (!record) return null;

    const { rows } = await pool.query(
      `SELECT v.document, v.created_at, v.deployed_by
       FROM notebooks n
       JOIN notebook_versions v ON v.id = n.deployed_version_id
       WHERE n.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return { isDeployed: false, deployedAt: null, deployedBy: null, hasUndeployedChanges: true };
    }

    const deployed = typeof rows[0].document === "string" ? rows[0].document : JSON.stringify(rows[0].document);
    const document = JSON.parse(deployed) as NotebookJson;

    return {
      isDeployed: true,
      deployedAt: new Date(rows[0].created_at).toISOString(),
      deployedBy: rows[0].deployed_by ?? null,
      hasUndeployedChanges: deployed !== JSON.stringify(this.parseDocument(record)),
      serving: {
        toolName:
          (document.inputs?.length ?? 0) > 0 || (document.outputs?.length ?? 0) > 0
            ? toolNameFor(document.name) || null
            : null,
        hasPage: (document.inputs?.length ?? 0) > 0 || (document.outputs?.length ?? 0) > 0,
        // Deploying a changed `packages:` changes what production installs, which is a
        // bigger change than most cell edits and the one least visible in a diff.
        packages: [...(document.packages ?? [])],
        triggers: (document.triggers ?? [])
          .filter((trigger) => trigger.enabled !== false)
          .map((trigger) =>
            trigger.kind === "cron"
              ? { kind: "cron" as const, label: trigger.cron }
              : { kind: "webhook" as const, label: `/hooks/${trigger.slug}` }
          ),
      },
    };
  }

  /**
   * Removes a notebook and everything that only existed because of it.
   *
   * Order matters and is not obvious: the notebook row points at a version, so that
   * pointer has to be dropped before the versions are, and runs point back at the
   * notebook, so they have to go before it. Getting this wrong leaves a row that cannot
   * be deleted and no error anyone reads.
   */
  async delete(id: string): Promise<{ success: boolean }> {
    await pool.query("UPDATE notebooks SET deployed_version_id = NULL WHERE id = $1", [id]);
    await pool.query("DELETE FROM notebook_runs WHERE notebook_id = $1", [id]);
    await pool.query("DELETE FROM notebook_versions WHERE notebook_id = $1", [id]);
    await notebookTriggersService.deleteByNotebook(id);
    await pool.query("DELETE FROM notebooks WHERE id = $1", [id]);

    notifyCatalogChanged({ change: "deleted", notebookId: id });
    return { success: true };
  }

  parseDocument(record: NotebookRecord): NotebookJson {
    return typeof record.document === "string"
      ? (JSON.parse(record.document) as NotebookJson)
      : (record.document as NotebookJson);
  }
}

export const notebooksService = new NotebooksService();

import fs from "fs";
import path from "path";
import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import { notebookTriggersService } from "./notebook-triggers.service.js";
import { STORAGE_DIR } from "./storage.service.js";
import { safeFilename } from "../core/storage-paths.js";
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

/** Shortest slug a webhook may have when no secret guards it. */
export const MIN_OPEN_SLUG_LENGTH = 22;

/**
 * A deploy that was refused for a reason the author can fix.
 *
 * A type of its own so the controller answers 409 with the message rather than a 500, and
 * so nothing has to recognise it by its wording.
 */
export class DeployRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployRefusedError";
  }
}

/** A deployed notebook as production sees it: its id, and the name and document of the version. */
export interface DeployedNotebook {
  id: string;
  name: string;
  document: NotebookJson;
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
    {
      document: NotebookJson;
      updatedAt: string;
      deployed: boolean;
      deployedDocument: NotebookJson | null;
    }[]
  > {
    const { rows } = await pool.query(
      `SELECT n.*, v.document AS deployed_document
       FROM notebooks n
       LEFT JOIN notebook_versions v ON v.id = n.deployed_version_id
       ORDER BY n.updated_at DESC`
    );
    return (
      rows as (NotebookRecord & {
        deployed_version_id: string | null;
        deployed_document: string | NotebookJson | null;
      })[]
    ).map((row) => ({
      document: this.parseDocument(row),
      updatedAt: new Date(row.updated_at).toISOString(),
      // The map draws it, so it has to travel with the document rather than be a second
      // query the map's caller is expected to remember.
      deployed: row.deployed_version_id !== null,
      // What production listens to. The map draws triggers from this, and only marks the
      // draft's as not active yet, because the draft changes nothing until a deploy.
      deployedDocument:
        row.deployed_document === null
          ? null
          : typeof row.deployed_document === "string"
            ? (JSON.parse(row.deployed_document) as NotebookJson)
            : row.deployed_document,
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
   * How a **production** run resolves `notebooks.run("...")` and a page button's target.
   *
   * Same rules as `findByIdOrName` — an id wins, an ambiguous name is refused — but the
   * names searched are the ones inside the *deployed versions*, not the `name` column,
   * which is the draft's. Without this, renaming a draft callee at 2pm broke the deployed
   * caller at 2:01 with "not found", and a draft that happened to share a callee's name
   * made the call ambiguous. A notebook that is not deployed has no name here at all: a
   * name reference to it is simply not found, and only an id reference can say
   * `"undeployed"`, because there the notebook is known to exist.
   */
  async findDeployedByIdOrName(
    reference: string
  ): Promise<DeployedNotebook | "ambiguous" | "undeployed" | null> {
    const { rows } = await pool.query(
      `SELECT n.id FROM notebooks n
       JOIN notebook_versions v ON v.id = n.deployed_version_id
       WHERE n.id::text = $1
       UNION ALL
       SELECT n.id FROM notebooks n
       JOIN notebook_versions v ON v.id = n.deployed_version_id
       WHERE (v.document::jsonb ->> 'name') = $1 AND n.id::text <> $1`,
      [reference]
    );

    if (rows.length > 1) return "ambiguous";
    if (rows.length === 0) {
      return (await this.getById(reference)) ? "undeployed" : null;
    }

    const id = String(rows[0].id);
    const document = await this.getDeployedDocument(id);
    return document ? { id, name: document.name, document } : null;
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

    // The trigger index is deliberately **not** written here. The document is the source
    // of truth for what a notebook declares, but the index answers "what is listening in
    // production", and production is the deployed version: `deploy()` writes the index
    // from the version it pins, `undeploy()` and `delete()` empty it. Syncing on save
    // meant an edit at 2pm could add a cron, drop a webhook secret or change a slug before
    // anyone pressed Deploy.

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

    // Before anything is written: a refused deploy leaves no version and no index rows.
    await this.assertDeployable(id, doc);

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
    // The index follows the version just pinned, from the same document that was stored as
    // that version, so what listens and what runs cannot come from two different reads.
    await notebookTriggersService.syncForNotebook(id, doc.triggers ?? []);

    notifyCatalogChanged({ change: "deployed", notebookId: id });
    return { versionId };
  }

  /**
   * What a deploy refuses, because production would otherwise be ambiguous or open.
   *
   * Two things, both about names that anyone on the internet or any caller will use:
   *
   *  - **The name must be free among deployed notebooks.** Production resolves
   *    `notebooks.run("name")` by deployed name, so two deployed notebooks sharing one
   *    would make every call to it ambiguous. Drafts stay free to share names; only the
   *    moment of deploying is checked, and re-deploying the notebook that holds the name
   *    is of course allowed.
   *  - **A webhook without a secret needs a slug nobody can guess.** The slug is then the
   *    only credential, so it must be at least `MIN_OPEN_SLUG_LENGTH` characters of
   *    `[A-Za-z0-9_-]`. A webhook with a secret may use any slug, and the automatic
   *    slug (a UUID) qualifies. Disabled triggers are not listening, so they are not held
   *    to it.
   */
  private async assertDeployable(id: string, doc: NotebookJson): Promise<void> {
    const { rows } = await pool.query(
      `SELECT n.id, n.name FROM notebooks n
       JOIN notebook_versions v ON v.id = n.deployed_version_id
       WHERE n.id <> $1 AND (v.document::jsonb ->> 'name') = $2`,
      [id, doc.name]
    );
    if (rows.length > 0) {
      throw new DeployRefusedError(
        `Cannot deploy "${doc.name}": the deployed notebook "${rows[0].name}" (${rows[0].id}) ` +
          `already uses that name, so calls by name would be ambiguous. Rename one of them first.`
      );
    }

    // Trigger ids and slugs are unique across the whole index, but a document only knows its
    // own — a duplicated notebook carries its original's. Checked here, before anything is
    // written, because the index is synced *after* the version and pointer: a clash found
    // there would leave production running the new code with the old triggers, and a 500.
    const declared = (doc.triggers ?? []).filter((trigger) =>
      trigger.kind === "cron" ? Boolean(trigger.cron?.trim()) : Boolean(trigger.slug?.trim())
    );
    const declaredSlugs = declared.flatMap((trigger) =>
      trigger.kind === "webhook" && trigger.slug ? [trigger.slug.trim()] : []
    );
    if (declared.length > 0) {
      const { rows: taken } = await pool.query(
        `SELECT t.id, t.slug, t.notebook_id FROM notebook_triggers t
         WHERE t.notebook_id <> $1 AND (t.id = ANY($2::text[]) OR t.slug = ANY($3::text[]))`,
        [id, declared.map((trigger) => trigger.id), declaredSlugs]
      );
      if (taken.length > 0) {
        const clash = taken[0];
        throw new DeployRefusedError(
          `Cannot deploy "${doc.name}": ` +
            (clash.slug && declaredSlugs.includes(clash.slug)
              ? `the webhook slug "${clash.slug}"`
              : `the trigger id "${clash.id}"`) +
            ` is already used by the deployed notebook ${clash.notebook_id}. ` +
            `Give this trigger a new slug or id (a duplicated notebook keeps its original's).`
        );
      }
    }

    const weak: string[] = [];
    for (const trigger of doc.triggers ?? []) {
      if (trigger.kind !== "webhook" || trigger.enabled === false) continue;
      const slug = trigger.slug?.trim();
      if (!slug || trigger.secretKey?.trim()) continue;
      if (slug.length < MIN_OPEN_SLUG_LENGTH || !/^[A-Za-z0-9_-]+$/.test(slug)) weak.push(slug);
    }
    if (weak.length > 0) {
      const slugs = weak.map((slug) => `"${slug}"`).join(", ");
      throw new DeployRefusedError(
        `Cannot deploy "${doc.name}": the webhook ${slugs} has no secretKey and its slug is ` +
          `too easy to guess. Add a secretKey, or use a slug of at least ${MIN_OPEN_SLUG_LENGTH} ` +
          `letters, digits, "-" or "_" (or leave the slug out to get a random one).`
      );
    }
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
    // Nobody is listening once nothing is deployed: the webhook answers 404 like any
    // unknown slug and the scheduler stops seeing the cron, rather than both reaching a
    // notebook that can only refuse.
    await notebookTriggersService.deleteByNotebook(id);
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

    const seg = safeFilename(id) || id;
    const uploadsFolder = path.join(STORAGE_DIR, "uploads", seg);
    const notebooksFolder = path.join(STORAGE_DIR, "notebooks", seg);
    if (fs.existsSync(uploadsFolder)) fs.rmSync(uploadsFolder, { recursive: true, force: true });
    if (fs.existsSync(notebooksFolder)) fs.rmSync(notebooksFolder, { recursive: true, force: true });

    notifyCatalogChanged({ change: "deleted", notebookId: id });
    return { success: true };
  }


  /**
   * The same notebook again, under a name that is free, as a draft.
   *
   * Two things here are deliberate rather than incidental. The copy gets a **new id**, so
   * it inherits nothing from the deploy table — copying a deployed notebook must not
   * start a second thing answering the same triggers. And the name is checked against the
   * ones already taken: nothing in the schema stops two notebooks sharing a name, but
   * `findByIdOrName` returns `"ambiguous"` when two do, which would make both of them
   * unreachable by name to every agent at once.
   */
  async duplicate(id: string, writer = "unknown"): Promise<{ id: string; name: string } | null> {
    const record = await this.getById(id);
    if (!record) return null;

    const sourceDoc = this.parseDocument(record);
    const base = `${sourceDoc.name || "Untitled Notebook"}-copy`;

    const { rows } = await pool.query<{ name: string }>("SELECT name FROM notebooks");
    const taken = new Set(rows.map((row) => row.name));

    let newName = base;
    for (let attempt = 2; taken.has(newName); attempt += 1) {
      newName = `${base}-${attempt}`;
    }

    const duplicatedDoc: NotebookJson = {
      ...sourceDoc,
      id: uuidv4(),
      name: newName,
    };

    return this.save(duplicatedDoc, writer);
  }

  parseDocument(record: NotebookRecord): NotebookJson {
    return typeof record.document === "string"
      ? (JSON.parse(record.document) as NotebookJson)
      : (record.document as NotebookJson);
  }
}

export const notebooksService = new NotebooksService();

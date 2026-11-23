import type { PoolClient } from "pg";
import { pool } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import { LOCK_KEYS, lockUntilTransactionEnds, notebookLockKey } from "../core/advisory-locks.js";
import { notebookTriggersService } from "./notebook-triggers.service.js";
import { stampAuthors, writerFor } from "../core/notebook-provenance.js";
import { actingUserId } from "../core/actor.js";
import { currentContext } from "../core/request-context.js";
import { audit } from "./audit.service.js";
import { toolNameFor } from "../core/notebook-tool-name.js";
import { notifyCatalogChanged } from "../core/catalog-events.js";
import { resolvePythonLockedPackages } from "../core/python-runner.js";
import { cellHostForOwner } from "./cell-host.service.js";
import { withOwnerDisk } from "../core/owner-disk.js";
import { cronProblem } from "../core/cron.js";
import { normaliseTags } from "@zaa-tool/shared";
import { notebookAccessService } from "./notebook-access.service.js";
import { notebookFilesService } from "./notebook-files.service.js";


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
  /** Whose secrets it runs with. Null for a notebook nobody owns. */
  owner_id: string | null;
  /** Moves on every save; what a save says it was made from. */
  revision: number;
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

/**
 * A save made from a revision that is no longer the current one.
 *
 * Its own type, so the controller answers 409 with the message and the MCP tools can tell
 * the agent to read again, and neither has to recognise it by its wording.
 */
export class NotebookConflictError extends Error {
  constructor(
    notebookName: string,
    readonly currentRevision: number
  ) {
    super(
      `"${notebookName}" was changed by someone else after you opened it (it is now at ` +
        `revision ${currentRevision}). Nothing was saved. Reload it to see their changes, ` +
        `then make your edit again.`
    );
    this.name = "NotebookConflictError";
  }
}

/**
 * A save over a notebook that exists, from a caller that did not say which revision it read.
 *
 * Its own type so the controller can answer 428 (the caller can fix it by reading first)
 * rather than 409 (somebody else changed it), and an agent is told what to do next.
 */
export class NotebookRevisionRequiredError extends Error {
  constructor(
    notebookName: string,
    readonly currentRevision: number
  ) {
    super(
      `"${notebookName}" already exists, and this save did not say which revision it was made ` +
        `from. Nothing was saved. Read the notebook, then send its revision with your save.`
    );
    this.name = "NotebookRevisionRequiredError";
  }
}

/**
 * Who made the save, as the browser may be told: a kind and a name, never an id or a token.
 * Read from the request context, so every way into `save` is covered without each passing it.
 */
function savedBy(): { kind: "user" | "agent"; name: string } | undefined {
  const actor = currentContext()?.actor;
  if (actor?.type === "user") return { kind: "user", name: actor.username };
  if (actor?.type === "agent") return { kind: "agent", name: actor.label };
  return undefined;
}

/** Anything a query can be sent to: the pool, or one connection inside a transaction. */
type Queryable = Pick<PoolClient, "query">;

/** What `save` may be told about the write. */
export interface SaveOptions {
  /**
   * The revision the caller's copy was read at. The save only goes through if the stored
   * revision is still that. Saving over a notebook that exists without naming one is refused
   * (`NotebookRevisionRequiredError`): a blind overwrite is how one person's edit silently
   * erased another's. Creating a new notebook needs none.
   *
   * `"any"` is for server-side writes that are deliberately not based on a read the caller
   * made (a restore, a transfer, a test fixture); the caller says so, and why, at the call.
   */
  expectedRevision?: number | "any";
}

/**
 * Turns the database's own refusal of a duplicate into the sentence a person can act on.
 *
 * `deploy` checks names, slugs and ids under a lock before writing, so these should not
 * happen; the unique indexes are the guarantee behind that check, and this is what is said
 * if one of them is the thing that catches it (an installation whose index was added later,
 * a second engine pointed at the same database).
 */
function refusalFromConstraint(err: unknown): DeployRefusedError | null {
  const { code, constraint } = err as { code?: string; constraint?: string };
  if (code !== "23505") return null;
  if (constraint === "notebooks_deployed_name_idx") {
    return new DeployRefusedError(
      "Another deployed notebook already uses this name, so calls by name would be ambiguous. Rename one of them first."
    );
  }
  if (constraint === "notebook_triggers_slug_key" || constraint === "notebook_triggers_pkey") {
    return new DeployRefusedError(
      "A trigger of this notebook uses a webhook slug or id that another deployed notebook already has. " +
        "Give the trigger a new slug or id (a duplicated notebook keeps its original's)."
    );
  }
  return null;
}

/** A deployed notebook as production sees it: its id, and the name and document of the version. */
export interface DeployedNotebook {
  id: string;
  name: string;
  document: NotebookJson;
  /** The version's id and who deployed it, for whoever has to decide whose secrets it runs with. */
  versionId: string;
  deployedByUserId: string | null;
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
   *
   * `only` narrows it to the notebooks a caller may see. It is the list the access module
   * hands out, not a rule written here: leave it out and this answers for the whole
   * installation, which only code that is not acting for a person may do.
   */
  async getSummary(only?: string[]): Promise<NotebookSummary[]> {
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
       WHERE ($1::text[] IS NULL OR n.id = ANY($1))
       ORDER BY n.updated_at DESC`,
      [only ?? null]
    );
    return rows;
  }

  /**
   * Every document at once, for anything that has to look at the whole workspace — or, with
   * `only`, at the part of it a caller may see.
   */
  async getAllDocuments(only?: string[]): Promise<
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
       WHERE ($1::text[] IS NULL OR n.id = ANY($1))
       ORDER BY n.updated_at DESC`,
      [only ?? null]
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
   *
   * `among` is the notebooks the caller may reach. A name is only ambiguous among those: a
   * notebook somebody else owns, called the same, is not a second candidate — it is not
   * there at all.
   */
  async findByIdOrName(
    reference: string,
    among?: string[]
  ): Promise<NotebookRecord | "ambiguous" | null> {
    const { rows } = await pool.query(
      `SELECT * FROM notebooks WHERE id::text = $1 AND ($2::text[] IS NULL OR id = ANY($2))
       UNION ALL
       SELECT * FROM notebooks WHERE name = $1 AND id::text <> $1 AND ($2::text[] IS NULL OR id = ANY($2))`,
      [reference, among ?? null]
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
   *
   * `among` narrows both searches, and the `"undeployed"` answer too: a notebook outside it
   * is not known to exist as far as this caller is concerned.
   */
  async findDeployedByIdOrName(
    reference: string,
    among?: string[]
  ): Promise<DeployedNotebook | "ambiguous" | "undeployed" | null> {
    const { rows } = await pool.query(
      `SELECT n.id FROM notebooks n
       JOIN notebook_versions v ON v.id = n.deployed_version_id
       WHERE n.id::text = $1 AND ($2::text[] IS NULL OR n.id = ANY($2))
       UNION ALL
       SELECT n.id FROM notebooks n
       JOIN notebook_versions v ON v.id = n.deployed_version_id
       WHERE (v.document::jsonb ->> 'name') = $1 AND n.id::text <> $1
         AND ($2::text[] IS NULL OR n.id = ANY($2))`,
      [reference, among ?? null]
    );

    if (rows.length > 1) return "ambiguous";
    if (rows.length === 0) {
      if (among !== undefined && !among.includes(reference)) return null;
      return (await this.getById(reference)) ? "undeployed" : null;
    }

    const id = String(rows[0].id);
    const deployed = await this.getDeployed(id);
    return deployed ? { id, name: deployed.document.name, ...deployed } : null;
  }

  /**
   * `writer` is who the engine authenticated, not who the request claims to be — it is
   * stamped onto the cells that actually changed, so authorship cannot be forged by
   * sending an `author` field.
   *
   * `ownerId` is who a *new* notebook belongs to, and is read only when this save creates
   * one: saving over an existing notebook never changes its owner, whoever is saving. Who
   * may save over which notebook is decided before this is called.
   */
  async save(
    document: NotebookJson,
    writer = "unknown",
    ownerId: string | null = null,
    options: SaveOptions = {}
  ): Promise<{ id: string; name: string; revision: number }> {
    const id = document.id || uuidv4();
    const name = document.name || "Untitled Notebook";
    const runtime: NotebookRuntime = document.runtime === "python" ? "python" : "node";
    const expected = options.expectedRevision === "any" ? undefined : options.expectedRevision;

    const existing = await this.getById(id);
    if (existing && options.expectedRevision === undefined) {
      throw new NotebookRevisionRequiredError(existing.name, existing.revision);
    }
    // Refused before the authors are stamped: nothing below is work worth doing for a write
    // that is not going to happen. The statement further down checks again, atomically —
    // this read and that write are two moments, and somebody can save in between.
    if (existing && expected !== undefined && existing.revision !== expected) {
      throw new NotebookConflictError(existing.name, existing.revision);
    }
    // `writer` is the name to show; who it really is comes from the actor the request was
    // authenticated as, so a token labelled like a username is still typed as an agent.
    const stored = stampAuthors(
      existing ? this.parseDocument(existing) : null,
      { ...document, id, name, runtime },
      writerFor(writer, currentContext()?.actor)
    );

    // The column is an index of the document, written from it on every save, exactly as
    // the trigger table is. Normalised here as well as in the editor, because an agent
    // writing the text form never passes through the editor.
    const tags = normaliseTags(stored.tags ?? []);

    // The WHERE is the guarantee: it is evaluated against the row as it is *now*, under the
    // row lock the conflict takes, so of two saves made from the same revision exactly one
    // finds it still current. No row back means the guard refused.
    const { rows } = await pool.query<{ revision: number }>(
      `INSERT INTO notebooks (id, name, runtime, document, tags, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           runtime = EXCLUDED.runtime,
           document = EXCLUDED.document,
           tags = EXCLUDED.tags,
           revision = notebooks.revision + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE $7::int IS NULL OR notebooks.revision = $7::int
       RETURNING revision`,
      [id, name, runtime, JSON.stringify(stored), tags, ownerId, expected ?? null]
    );
    if (rows.length === 0) {
      const current = await this.getById(id);
      throw new NotebookConflictError(current?.name ?? name, current?.revision ?? 0);
    }

    // The trigger index is deliberately **not** written here. The document is the source
    // of truth for what a notebook declares, but the index answers "what is listening in
    // production", and production is the deployed version: `deploy()` writes the index
    // from the version it pins, `undeploy()` and `delete()` empty it. Syncing on save
    // meant an edit at 2pm could add a cron, drop a webhook secret or change a slug before
    // anyone pressed Deploy.

    // Announced here rather than by the caller. There are four ways into this method —
    // the editor, an import, `notebook_write`, `notebook_edit_cell` — and the old
    // arrangement, where each caller remembered, had announced none of them.
    notifyCatalogChanged({
      change: "saved",
      notebookId: id,
      revision: rows[0].revision,
      ...(savedBy() ? { by: savedBy() } : {}),
    });

    await audit.record({
      action: existing ? "notebook.save" : "notebook.create",
      target: { type: "notebook", id, ownerId: existing ? existing.owner_id : ownerId, name },
      meta: { revision: rows[0].revision, ...(existing ? { previousRevision: existing.revision } : {}) },
    });

    return { id, name, revision: rows[0].revision };
  }

  /**
   * Pins the current draft as what production runs.
   *
   * The gate this whole thing exists for. Before it, saving was publishing: editing a
   * notebook at 2pm changed what its webhook did at 2:01, which was survivable while
   * only you could edit and became indefensible once an agent could.
   */
  async deploy(
    id: string,
    deployedBy: string,
    deployedByUserId: string | null = actingUserId(currentContext()?.actor)
  ): Promise<{ versionId: string } | null> {
    // A package lock is resolved by running `uv`, which can take minutes, so it happens with
    // no lock and no transaction held. The packages it was resolved for are remembered, and
    // if somebody saves different ones while it ran the lock is simply done again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const record = await this.getById(id);
      if (!record) return null;
      const lockedFor = JSON.stringify(this.parseDocument(record).packages ?? []);

      // A first look before the slow part, so a deploy that is going to be refused is
      // refused in milliseconds. It decides nothing: the check that counts is the one made
      // below under the locks.
      await this.assertDeployable(pool, id, this.parseDocument(record));
      const locked = await this.lockPackagesOf(record);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // This notebook's deploys, undeploys and deletes go one at a time. Everything below
        // is one transaction: a deploy that fails anywhere leaves no version row, no moved
        // pointer and no half-written trigger index behind it.
        await lockUntilTransactionEnds(client, notebookLockKey(id));

        const { rows } = await client.query<NotebookRecord>("SELECT * FROM notebooks WHERE id = $1", [id]);
        const fresh = rows[0];
        if (!fresh) {
          await client.query("ROLLBACK");
          return null;
        }
        const doc = this.parseDocument(fresh);
        if (JSON.stringify(doc.packages ?? []) !== lockedFor) {
          await client.query("ROLLBACK");
          continue;
        }

        // The names deployed notebooks go by, and their trigger ids and slugs, are checked
        // against one another by everyone who deploys, so that check is one at a time too.
        // Taken after the per-notebook lock and only ever in that order, which is what
        // keeps two deploys from waiting on each other.
        await lockUntilTransactionEnds(client, LOCK_KEYS.deployedNames);
        await this.assertDeployable(client, id, doc);

        const versionId = uuidv4();
        await client.query(
          `INSERT INTO notebook_versions (id, notebook_id, document, deployed_by, deployed_by_user_id, locked_packages)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [versionId, id, JSON.stringify(doc), deployedBy, deployedByUserId, locked]
        );
        await client.query(
          "UPDATE notebooks SET deployed_version_id = $1, deployed_name = $2 WHERE id = $3",
          [versionId, doc.name, id]
        );
        // The index follows the version just pinned, from the same document that was stored as
        // that version, so what listens and what runs cannot come from two different reads.
        await notebookTriggersService.syncForNotebook(id, doc.triggers ?? [], client);
        await client.query("COMMIT");

        await audit.record({
          action: "notebook.deploy",
          target: { type: "notebook", id, ownerId: fresh.owner_id, name: doc.name },
          meta: { versionId, revision: fresh.revision },
        });
        notifyCatalogChanged({ change: "deployed", notebookId: id });
        return { versionId };
      } catch (err: unknown) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw refusalFromConstraint(err) ?? err;
      } finally {
        client.release();
      }
    }
    throw new DeployRefusedError(
      "The notebook's packages kept changing while it was being deployed. Try again once nobody is editing them."
    );
  }

  /** The exact package versions a Python notebook runs with once deployed; null when it has none. */
  private async lockPackagesOf(record: NotebookRecord): Promise<string[] | null> {
    const doc = this.parseDocument(record);
    if (record.runtime !== "python" || !Array.isArray(doc.packages) || doc.packages.length === 0) {
      return null;
    }
    // In the notebook's owner's group, with their package cache: the same as its cells.
    const host = await cellHostForOwner(record.owner_id, new Set());
    const packages = doc.packages;
    // Installing fills the owner's package cache like a cell does, so it is held to the same disk quota.
    return withOwnerDisk(host, () => resolvePythonLockedPackages(packages, host), (message) => {
      throw new DeployRefusedError(message);
    });
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
  private async assertDeployable(
    db: Queryable,
    id: string,
    doc: NotebookJson
  ): Promise<void> {
    const { rows } = await db.query(
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
      const { rows: taken } = await db.query(
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

    // A cron that does not parse never fires, and nothing says so. Refused here, where the
    // author is looking, rather than discovered when the 9am report does not arrive.
    for (const trigger of doc.triggers ?? []) {
      if (trigger.kind !== "cron" || !trigger.cron?.trim()) continue;
      const problem = cronProblem(trigger.cron);
      if (problem) {
        throw new DeployRefusedError(
          `Cannot deploy "${doc.name}": the cron schedule "${trigger.cron.trim()}" is not valid (${problem}).`
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

    // Asked while the page still exists: afterwards nobody who used it is one any more, and
    // they are exactly the ones whose list has to be told it went.
    const audience = await notebookAccessService.audienceOf(id);

    // One transaction, behind any deploy of this notebook that is already running: the
    // pointer and the trigger index move together, so a deploy racing this cannot leave a
    // pinned version with no triggers, or triggers with no version.
    const client = await pool.connect();
    let wasDeployed: boolean;
    try {
      await client.query("BEGIN");
      await lockUntilTransactionEnds(client, notebookLockKey(id));
      const { rowCount } = await client.query(
        "UPDATE notebooks SET deployed_version_id = NULL, deployed_name = NULL WHERE id = $1 AND deployed_version_id IS NOT NULL",
        [id]
      );
      wasDeployed = (rowCount ?? 0) > 0;
      // Nobody is listening once nothing is deployed: the webhook answers 404 like any
      // unknown slug and the scheduler stops seeing the cron, rather than both reaching a
      // notebook that can only refuse.
      await notebookTriggersService.deleteByNotebook(id, client);
      await client.query("COMMIT");
    } catch (err: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    // Only when something actually moved. Announcing an undeploy of a notebook that was
    // never deployed would send every open screen to refetch a list that did not change.
    if (wasDeployed) {
      await audit.record({
        action: "notebook.undeploy",
        target: { type: "notebook", id, ownerId: record.owner_id, name: record.name },
      });
      notifyCatalogChanged({ change: "undeployed", notebookId: id, audience });
    }
    return { wasDeployed };
  }

  /** What a trigger should run, or null when nothing has been deployed yet. */
  async getDeployedDocument(id: string): Promise<NotebookJson | null> {
    return (await this.getDeployed(id))?.document ?? null;
  }

  /** The deployed version with who deployed it, read in one query so the two cannot disagree. */
  async getDeployed(
    id: string
  ): Promise<{ document: NotebookJson; versionId: string; deployedByUserId: string | null } | null> {
    const { rows } = await pool.query(
      `SELECT v.id AS version_id, v.document, v.locked_packages, v.deployed_by_user_id
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
    return {
      document: doc,
      versionId: String(rows[0].version_id),
      deployedByUserId: rows[0].deployed_by_user_id ?? null,
    };
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
      `SELECT v.document, v.created_at, v.deployed_by, v.deployed_by_user_id
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
      // Production runs hand a version's cells the secrets of whoever deployed it, so when
      // that is not the owner the owner is told, by name, whose secrets the declared ones are.
      productionSecretsFrom:
        (document.secrets ?? []).length > 0 &&
        rows[0].deployed_by_user_id &&
        rows[0].deployed_by_user_id !== record.owner_id
          ? (rows[0].deployed_by ?? null)
          : null,
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
    // Before the row goes: once it has, there is nothing left to ask who could see it, or
    // what it was called and whose it was — which is what the audit event keeps.
    const audience = await notebookAccessService.audienceOf(id);
    const doomed = await this.getById(id);

    // Runs that are still going are stopped first, through the same cancel a person's button
    // uses. Otherwise a run outlives its notebook and keeps writing — into a folder this
    // method is about to remove, or one the write itself would bring back.
    await this.cancelActiveRuns(id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockUntilTransactionEnds(client, notebookLockKey(id));
      await client.query("UPDATE notebooks SET deployed_version_id = NULL WHERE id = $1", [id]);
      await client.query("DELETE FROM notebook_runs WHERE notebook_id = $1", [id]);
      await client.query("DELETE FROM notebook_versions WHERE notebook_id = $1", [id]);
      await notebookTriggersService.deleteByNotebook(id, client);
      await client.query("DELETE FROM notebooks WHERE id = $1", [id]);
      await client.query("COMMIT");
    } catch (err: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // Under the notebook's file lock, after the row is gone: a write that was already in the
    // queue finds no notebook and refuses, and one that was in flight finishes before the
    // folders are removed, so nothing is left to be recreated behind this.
    await notebookFilesService.removeFolders(id);

    if (doomed) {
      await audit.record({
        action: "notebook.delete",
        target: { type: "notebook", id, ownerId: doomed.owner_id, name: doomed.name },
        meta: { revision: doomed.revision },
      });
    }
    notifyCatalogChanged({ change: "deleted", notebookId: id, audience });
    return { success: true };
  }

  /**
   * Cancels every root run of a notebook that is still going, and gives them a moment to end.
   *
   * It asks the execution service rather than keeping a list of its own: how a run is
   * stopped is that service's business. Imported when needed because it imports this one.
   */
  private async cancelActiveRuns(notebookId: string): Promise<void> {
    const { notebookExecutionService } = await import("./notebook-execution.service.js");
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM notebook_runs WHERE notebook_id = $1 AND status = 'running' AND parent_run_id IS NULL",
      [notebookId]
    );
    if (rows.length === 0) return;
    const stopped = rows.filter((run) => notebookExecutionService.cancel(run.id, "the deletion of this notebook"));
    // A row marked running that is not active here (the engine restarted under it) has
    // nothing to wait for.
    if (stopped.length === 0) return;

    // A cancel aborts the run's signal; the run records its end a moment later. Waited for
    // briefly so the history that is deleted next is not being written to at the same time.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows: still } = await pool.query(
        "SELECT 1 FROM notebook_runs WHERE notebook_id = $1 AND status = 'running' AND parent_run_id IS NULL",
        [notebookId]
      );
      if (still.length === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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
   *
   * The copy belongs to whoever copied it, and "taken" means taken among *their* notebooks:
   * a name is only ambiguous among the ones a person can reach, so another owner's notebook
   * called the same does not make theirs unreachable — and must not show up in the answer.
   */
  async duplicate(
    id: string,
    writer = "unknown",
    ownerId: string | null = null
  ): Promise<{ id: string; name: string } | null> {
    const record = await this.getById(id);
    if (!record) return null;

    const sourceDoc = this.parseDocument(record);
    const base = `${sourceDoc.name || "Untitled Notebook"}-copy`;

    const among = ownerId === null ? null : await notebookAccessService.editableIds(ownerId);
    const { rows } = await pool.query<{ name: string }>(
      "SELECT name FROM notebooks WHERE $1::text[] IS NULL OR id = ANY($1)",
      [among]
    );
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

    return this.save(duplicatedDoc, writer, ownerId);
  }

  /** A notebook as the audit trail names it: its id, whose it is, and what it was called. */
  async auditTarget(id: string): Promise<{ type: string; id: string; ownerId: string | null; name: string | null }> {
    const { rows } = await pool.query<{ name: string; owner_id: string | null }>(
      "SELECT name, owner_id FROM notebooks WHERE id = $1",
      [id]
    );
    return { type: "notebook", id, ownerId: rows[0]?.owner_id ?? null, name: rows[0]?.name ?? null };
  }

  parseDocument(record: NotebookRecord): NotebookJson {
    return typeof record.document === "string"
      ? (JSON.parse(record.document) as NotebookJson)
      : (record.document as NotebookJson);
  }
}

export const notebooksService = new NotebooksService();

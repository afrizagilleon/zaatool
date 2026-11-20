import { pool } from "../db/connection.js";

/**
 * The one place that decides who may touch a notebook.
 *
 * REST, MCP, the WebSocket, nested calls, webhooks and storage all ask here, and none of
 * them writes its own version of the question. That is the whole design: the first draft
 * of "who can see what" is never the problem, the fourth door somebody forgot to put it on
 * is. A door that wants a different answer has to change this file, where the change is
 * visible to everyone who relies on it.
 *
 * What a person can be to a notebook:
 *
 *  - `owner`  — made it, or was handed it. One per notebook.
 *  - `editor` — invited by the owner. Reads and writes the draft, deploys it, runs it.
 *  - `app`    — may use the deployed page. Never sees the source, and only sees their own
 *               runs. Everybody is this for a notebook whose visibility is `all` and which
 *               is deployed; for `selected`, only the people named.
 *  - `null`   — nothing. The caller is told the notebook does not exist, because "it
 *               exists but you may not" is itself something they were not entitled to know.
 *
 * `owner` and `editor` are decided by the notebook *and* the account: only a `creator` can
 * be either, so demoting an account to `viewer` takes its write access away without anyone
 * having to remember to edit the notebooks it touched.
 */
export type NotebookAccess = "owner" | "editor" | "app";

/** How much of a notebook's run history somebody may read. */
export type RunScope = "all" | "own" | "none";

/** A refusal whose message was written for the person who sent the request. */
export class AccessInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessInputError";
  }
}

interface PersonRow {
  role: string | null;
  active: boolean | null;
}

interface GrantRow {
  id: string;
  owner_id: string | null;
  app_visibility: "all" | "selected";
  deployed: boolean;
  is_editor: boolean;
  is_app_user: boolean;
}

/** One query shape for one notebook or for all of them, so the two cannot disagree. */
const GRANTS_SQL = `
  SELECT n.id, n.owner_id, n.app_visibility,
         (n.deployed_version_id IS NOT NULL) AS deployed,
         EXISTS (SELECT 1 FROM notebook_access a
                 WHERE a.notebook_id = n.id AND a.user_id = $1 AND a.permission = 'editor') AS is_editor,
         EXISTS (SELECT 1 FROM notebook_access a
                 WHERE a.notebook_id = n.id AND a.user_id = $1 AND a.permission = 'app') AS is_app_user
  FROM notebooks n`;

async function personOf(userId: string): Promise<PersonRow | null> {
  const { rows } = await pool.query<PersonRow>(
    "SELECT role, active FROM users WHERE id = $1",
    [userId]
  );
  return rows[0] ?? null;
}

/** The rule itself, written once. Everything below is a way of asking it. */
function decide(userId: string, person: PersonRow, grant: GrantRow): NotebookAccess | null {
  if (person.active === false) return null;

  if (person.role === "creator") {
    if (grant.owner_id === userId) return "owner";
    if (grant.is_editor) return "editor";
  }

  // Nobody uses a page that is not in production; an owner or editor reaches the draft
  // above, so this only ever turns away somebody who would have been a page user.
  if (!grant.deployed) return null;
  if (grant.app_visibility === "all") return "app";
  if (grant.is_app_user) return "app";
  return null;
}

export const isEditAccess = (access: NotebookAccess | null): boolean =>
  access === "owner" || access === "editor";

export class NotebookAccessService {
  /** What `userId` is to the notebook, or null — including when there is no such notebook. */
  async accessFor(userId: string, notebookId: string): Promise<NotebookAccess | null> {
    const person = await personOf(userId);
    if (!person) return null;
    const { rows } = await pool.query<GrantRow>(`${GRANTS_SQL} WHERE n.id = $2`, [userId, notebookId]);
    return rows[0] ? decide(userId, person, rows[0]) : null;
  }

  /** Read and write the draft, deploy it, run it, share it. */
  async canEdit(userId: string, notebookId: string): Promise<boolean> {
    return isEditAccess(await this.accessFor(userId, notebookId));
  }

  /** Delete it, and decide who else gets in. */
  async isOwner(userId: string, notebookId: string): Promise<boolean> {
    return (await this.accessFor(userId, notebookId)) === "owner";
  }

  /**
   * Run the deployed version. An owner or editor may too — but only once there is one,
   * which is what separates this from `canEdit`.
   */
  async canUseApp(userId: string, notebookId: string): Promise<boolean> {
    const access = await this.accessFor(userId, notebookId);
    if (access === null) return false;
    const { rows } = await pool.query(
      "SELECT (deployed_version_id IS NOT NULL) AS deployed FROM notebooks WHERE id = $1",
      [notebookId]
    );
    return rows[0]?.deployed === true;
  }

  /** The notebooks `userId` may open, change and deploy: the editor's list. */
  async editableIds(userId: string): Promise<string[]> {
    return this.idsWhere(userId, (access) => isEditAccess(access));
  }

  /** The notebooks `userId` may run as a deployed page: the Apps list. */
  async appIds(userId: string): Promise<string[]> {
    const person = await personOf(userId);
    if (!person) return [];
    const { rows } = await pool.query<GrantRow>(GRANTS_SQL, [userId]);
    return rows
      .filter((row) => row.deployed && decide(userId, person, row) !== null)
      .map((row) => row.id);
  }

  /**
   * What a notebook run on behalf of `userId` may call: anything they could use as an app,
   * plus their own drafts — so that testing a caller by hand can exercise a callee that is
   * not deployed yet, which is the whole point of a draft run.
   */
  async callableIds(userId: string): Promise<string[]> {
    return this.idsWhere(userId, (access) => access !== null);
  }

  /**
   * Ids of notebooks the person may not change — the ones whose folders in storage are
   * somebody else's.
   */
  async notEditableIds(userId: string): Promise<string[]> {
    const person = await personOf(userId);
    const { rows } = await pool.query<GrantRow>(GRANTS_SQL, [userId]);
    return rows
      .filter((row) => !(person && isEditAccess(decide(userId, person, row))))
      .map((row) => row.id);
  }

  private async idsWhere(
    userId: string,
    keep: (access: NotebookAccess | null) => boolean
  ): Promise<string[]> {
    const person = await personOf(userId);
    if (!person) return [];
    const { rows } = await pool.query<GrantRow>(GRANTS_SQL, [userId]);
    return rows.filter((row) => keep(decide(userId, person, row))).map((row) => row.id);
  }

  /**
   * How much of a notebook's history `userId` reads: every run for the people who work on
   * it, only their own for somebody who merely uses it, nothing for anyone else.
   */
  async runScope(userId: string, notebookId: string): Promise<RunScope> {
    const access = await this.accessFor(userId, notebookId);
    if (access === null) return "none";
    return isEditAccess(access) ? "all" : "own";
  }

  /** The same rule for one run already in hand. A run nobody started is only the team's. */
  async canSeeRun(
    userId: string,
    run: { notebook_id: string; started_by: string | null }
  ): Promise<boolean> {
    const scope = await this.runScope(userId, run.notebook_id);
    if (scope === "all") return true;
    return scope === "own" && run.started_by === userId;
  }

  /** Whose secrets a notebook runs with. NULL when it has no owner. */
  async ownerOf(notebookId: string): Promise<string | null> {
    const { rows } = await pool.query<{ owner_id: string | null }>(
      "SELECT owner_id FROM notebooks WHERE id = $1",
      [notebookId]
    );
    return rows[0]?.owner_id ?? null;
  }

  /**
   * Who should hear that a notebook changed, as account ids — or null for everybody.
   *
   * Asked *before* a delete, because afterwards there is nothing left to ask about: the
   * announcement of a deletion is the one that cannot be filtered by looking the notebook
   * up. Everybody means an app that was open to everyone, whose users are not listed.
   */
  async audienceOf(notebookId: string): Promise<string[] | null> {
    const { rows } = await pool.query<{
      owner_id: string | null;
      app_visibility: string;
      deployed: boolean;
    }>(
      `SELECT owner_id, app_visibility, (deployed_version_id IS NOT NULL) AS deployed
       FROM notebooks WHERE id = $1`,
      [notebookId]
    );
    if (!rows[0]) return [];
    if (rows[0].deployed && rows[0].app_visibility === "all") return null;

    const { rows: granted } = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM notebook_access WHERE notebook_id = $1",
      [notebookId]
    );
    return [
      ...(rows[0].owner_id ? [rows[0].owner_id] : []),
      ...granted.map((row) => row.user_id),
    ];
  }

  // ── who a notebook is shared with ───────────────────────────────────────────

  /** The settings page: owner, editors, and who may use the app. */
  async describe(notebookId: string): Promise<{
    owner: { id: string; username: string } | null;
    editors: { id: string; username: string }[];
    appVisibility: "all" | "selected";
    appUsers: { id: string; username: string }[];
  }> {
    const { rows } = await pool.query<{
      owner_id: string | null;
      owner_name: string | null;
      app_visibility: "all" | "selected";
    }>(
      `SELECT n.owner_id, u.username AS owner_name, n.app_visibility
       FROM notebooks n LEFT JOIN users u ON u.id = n.owner_id
       WHERE n.id = $1`,
      [notebookId]
    );
    const row = rows[0];

    const { rows: granted } = await pool.query<{ id: string; username: string; permission: string }>(
      `SELECT u.id, u.username, a.permission
       FROM notebook_access a JOIN users u ON u.id = a.user_id
       WHERE a.notebook_id = $1
       ORDER BY u.username`,
      [notebookId]
    );
    const pick = (permission: string) =>
      granted.filter((entry) => entry.permission === permission).map(({ id, username }) => ({ id, username }));

    return {
      owner: row?.owner_id && row.owner_name ? { id: row.owner_id, username: row.owner_name } : null,
      editors: pick("editor"),
      appVisibility: row?.app_visibility ?? "all",
      appUsers: pick("app"),
    };
  }

  /**
   * Replaces the lists it is given and leaves the ones it is not.
   *
   * Validated before anything is written, because a half-applied change to who can see a
   * notebook is worse than a refused one. Only a creator can be an editor (an editor writes
   * code, and code is what a creator is for); anybody can be named as a page user. Naming the
   * owner, or naming somebody twice, is not an error and adds nothing.
   */
  async update(
    notebookId: string,
    change: { editors?: string[]; appVisibility?: string; appUsers?: string[] }
  ): Promise<void> {
    if (
      change.appVisibility !== undefined &&
      change.appVisibility !== "all" &&
      change.appVisibility !== "selected"
    ) {
      throw new AccessInputError('appVisibility must be "all" or "selected".');
    }

    const owner = await this.ownerOf(notebookId);

    const resolve = async (
      usernames: string[] | undefined,
      mustBeCreator: boolean,
      label: string
    ): Promise<string[] | undefined> => {
      if (usernames === undefined) return undefined;
      const ids: string[] = [];
      for (const raw of usernames) {
        const username = String(raw ?? "").trim();
        const { rows } = await pool.query<{ id: string; role: string | null }>(
          "SELECT id, role FROM users WHERE username = $1",
          [username]
        );
        if (!rows[0]) throw new AccessInputError(`There is no account named "${username}" (${label}).`);
        if (mustBeCreator && rows[0].role !== "creator") {
          throw new AccessInputError(
            `"${username}" has a ${rows[0].role ?? "viewer"} account, and only a creator can be an editor.`
          );
        }
        if (rows[0].id !== owner && !ids.includes(rows[0].id)) ids.push(rows[0].id);
      }
      return ids;
    };

    const editors = await resolve(change.editors, true, "editors");
    const appUsers = await resolve(change.appUsers, false, "app users");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (change.appVisibility !== undefined) {
        await client.query("UPDATE notebooks SET app_visibility = $1 WHERE id = $2", [
          change.appVisibility,
          notebookId,
        ]);
      }
      if (editors !== undefined) {
        await client.query(
          "DELETE FROM notebook_access WHERE notebook_id = $1 AND permission = 'editor'",
          [notebookId]
        );
        for (const id of editors) {
          await client.query(
            `INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'editor')
             ON CONFLICT (notebook_id, user_id) DO UPDATE SET permission = 'editor'`,
            [notebookId, id]
          );
        }
      }
      if (appUsers !== undefined) {
        await client.query(
          "DELETE FROM notebook_access WHERE notebook_id = $1 AND permission = 'app'",
          [notebookId]
        );
        for (const id of appUsers) {
          // An editor already reaches the page; the row would only be shadowed by theirs.
          await client.query(
            `INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'app')
             ON CONFLICT (notebook_id, user_id) DO NOTHING`,
            [notebookId, id]
          );
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── storage ─────────────────────────────────────────────────────────────────

  /**
   * Whether a path inside storage is somebody else's notebook's folder.
   *
   * Only `notebooks/<id>/` and `uploads/<id>/` belong to a notebook; every other folder is
   * shared among creators, which is how it has always worked and is written down rather
   * than fixed here. A folder named after an id that no notebook has is nobody's secret.
   */
  async hiddenFromStorage(userId: string): Promise<(relativePath: string) => boolean> {
    const hidden = new Set(await this.notEditableIds(userId));
    return (relativePath: string): boolean => {
      const [top, id] = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
      return (top === "notebooks" || top === "uploads") && id !== undefined && hidden.has(id);
    };
  }

  // ── recovery ────────────────────────────────────────────────────────────────

  /**
   * Hands notebooks from one account to another. The only way a notebook without an owner
   * gets one, and the way back from a person leaving: there is no administrator in the app,
   * so this is run on the server by whoever runs the server.
   *
   * The recipient also gets a copy of every secret the notebook names that they do not
   * already have, because a notebook runs with its *owner's* secrets and one handed over
   * without them would fail on the next cron tick. A secret they already have is left alone:
   * their value wins, and overwriting a credential somebody set is not recovery.
   */
  async transferOwner(
    toUsername: string,
    from: { username?: string; notebookId?: string }
  ): Promise<{ notebooks: string[]; copiedSecrets: string[] }> {
    const { rows: target } = await pool.query<{ id: string; role: string | null }>(
      "SELECT id, role FROM users WHERE username = $1",
      [toUsername]
    );
    if (!target[0]) throw new AccessInputError(`There is no account named "${toUsername}".`);
    if (target[0].role !== "creator") {
      throw new AccessInputError(`"${toUsername}" is not a creator, and only a creator can own a notebook.`);
    }

    let source: string | null = null;
    if (from.username !== undefined) {
      const { rows } = await pool.query<{ id: string }>("SELECT id FROM users WHERE username = $1", [
        from.username,
      ]);
      if (!rows[0]) throw new AccessInputError(`There is no account named "${from.username}".`);
      source = rows[0].id;
    }

    const { rows: moved } = await pool.query<{
      id: string;
      document: unknown;
      deployed_document: unknown;
      owner_id: string | null;
    }>(
      `SELECT n.id, n.document, v.document AS deployed_document, n.owner_id
       FROM notebooks n LEFT JOIN notebook_versions v ON v.id = n.deployed_version_id
       WHERE ($1::text IS NULL OR n.owner_id = $1)
         AND ($2::text IS NULL OR n.id = $2)
         AND ($1::text IS NOT NULL OR $2::text IS NOT NULL OR n.owner_id IS NULL)`,
      [source, from.notebookId ?? null]
    );

    const copied = new Set<string>();
    for (const notebook of moved) {
      const keys = [
        ...new Set([...secretKeysOf(notebook.document), ...secretKeysOf(notebook.deployed_document)]),
      ];
      if (keys.length > 0 && notebook.owner_id) {
        const { rows } = await pool.query<{ key: string }>(
          `INSERT INTO secrets (id, key, value, is_secret, created_at, owner_id)
           SELECT md5(random()::text || clock_timestamp()::text || s.id), s.key, s.value, s.is_secret, s.created_at, $2
           FROM secrets s
           WHERE s.owner_id = $1 AND s.key = ANY($3)
           ON CONFLICT (owner_id, key) DO NOTHING
           RETURNING key`,
          [notebook.owner_id, target[0].id, keys]
        );
        for (const row of rows) copied.add(row.key);
      }
      await pool.query("UPDATE notebooks SET owner_id = $1 WHERE id = $2", [target[0].id, notebook.id]);
      // The new owner is not also their own editor.
      await pool.query(
        "DELETE FROM notebook_access WHERE notebook_id = $1 AND user_id = $2",
        [notebook.id, target[0].id]
      );
    }

    return { notebooks: moved.map((notebook) => notebook.id), copiedSecrets: [...copied] };
  }
}

/**
 * The secret names a stored document declares, and the ones its webhooks are guarded by —
 * what a transfer has to carry along.
 */
function secretKeysOf(document: unknown): string[] {
  try {
    const parsed = (typeof document === "string" ? JSON.parse(document) : document) as {
      secrets?: unknown;
      triggers?: { secretKey?: unknown }[];
    } | null;
    const declared = Array.isArray(parsed?.secrets)
      ? parsed.secrets.filter((key): key is string => typeof key === "string")
      : [];
    const guards = (parsed?.triggers ?? []).flatMap((trigger) =>
      typeof trigger?.secretKey === "string" && trigger.secretKey.trim() ? [trigger.secretKey.trim()] : []
    );
    return [...declared, ...guards];
  } catch {
    return [];
  }
}

export const notebookAccessService = new NotebookAccessService();

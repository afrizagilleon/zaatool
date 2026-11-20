/**
 * FX-17 — who owns what.
 *
 * A notebook has one owner. The owner and the editors they invite can see and change it;
 * everyone else is told it does not exist. A deployed notebook is an app, and an app is
 * used by everybody or by a chosen few, who never see its source and only see their own
 * runs. Secrets and agent tokens belong to the account that made them.
 *
 * Everything this creates is prefixed `zz-fx17-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx17-ownership
 */
import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";
import { notebookAccessService } from "../src/services/notebook-access.service.js";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n").join("\n       ")}`);
  }
}

const PASSWORD = "zz-fx17-password-long";

async function clean(): Promise<void> {
  await pool.query("DELETE FROM notebook_runs WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx17-%')");
  await pool.query("DELETE FROM notebook_triggers WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx17-%')");
  await pool.query("UPDATE notebooks SET deployed_version_id = NULL WHERE name LIKE 'zz-fx17-%'");
  await pool.query("DELETE FROM notebook_versions WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx17-%')");
  await pool.query("DELETE FROM notebook_shares WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx17-%')");
  await pool.query("DELETE FROM notebooks WHERE name LIKE 'zz-fx17-%'");
  await pool.query("DELETE FROM secrets WHERE key LIKE 'zz-fx17-%'");
  await pool.query("DELETE FROM agent_tokens WHERE label LIKE 'zz-fx17-%'");
  await pool.query("DELETE FROM users WHERE username LIKE 'zz-fx17-%'");
}

await initDb();
await clean();

// ── the migration (T-01) ──────────────────────────────────────────────────────
//
// Run first, against a schema put back the way it was before this work: no owner column,
// the old UNIQUE(key) on secrets, no user on a token. `initDb()` is then the migration.

console.log("\nmigrating an installation that predates owners");

async function legacySchema(): Promise<void> {
  await pool.query("ALTER TABLE notebooks DROP COLUMN IF EXISTS owner_id CASCADE");
  await pool.query("ALTER TABLE secrets DROP COLUMN IF EXISTS owner_id CASCADE");
  await pool.query("ALTER TABLE secrets DROP CONSTRAINT IF EXISTS secrets_key_key");
  await pool.query("ALTER TABLE secrets ADD CONSTRAINT secrets_key_key UNIQUE (key)");
  await pool.query("ALTER TABLE agent_tokens DROP COLUMN IF EXISTS user_id CASCADE");
}

async function seedUser(name: string, role: "creator" | "viewer", createdAt: string): Promise<string> {
  const user = await authService.createUser(`zz-fx17-${name}`, PASSWORD, role);
  await pool.query("UPDATE users SET created_at = $1 WHERE id = $2", [createdAt, user.id]);
  return user.id;
}

async function seedNotebook(name: string, deployedBy: string | null): Promise<string> {
  const id = `zz-fx17-nb-${name}`;
  await pool.query(
    "INSERT INTO notebooks (id, name, runtime, document) VALUES ($1, $2, 'node', $3)",
    [id, `zz-fx17-${name}`, JSON.stringify({ version: "1.0", id, name: `zz-fx17-${name}`, runtime: "node", steps: [] })]
  );
  if (deployedBy !== null) {
    await pool.query(
      "INSERT INTO notebook_versions (id, notebook_id, document, deployed_by) VALUES ($1, $2, '{}', $3)",
      [`zz-fx17-v-${name}`, id, deployedBy]
    );
  }
  return id;
}

async function ownerOf(id: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT owner_id FROM notebooks WHERE id = $1", [id]);
  return rows[0].owner_id;
}

await legacySchema();
const firstCreator = await seedUser("m-first", "creator", "1900-01-01");
const secondCreator = await seedUser("m-second", "creator", "1900-01-02");
await seedUser("m-viewer", "viewer", "1900-01-03");

const byDeployer = await seedNotebook("m-by-deployer", "zz-fx17-m-second");
const byGhost = await seedNotebook("m-by-ghost", "zz-fx17-m-ghost");
const byViewer = await seedNotebook("m-by-viewer", "zz-fx17-m-viewer");
const byMigration = await seedNotebook("m-by-migration", "migration");

await pool.query("INSERT INTO secrets (id, key, value, is_secret) VALUES ('zz-fx17-s1', 'zz-fx17-API', 'v1', true)");
await pool.query("INSERT INTO secrets (id, key, value, is_secret) VALUES ('zz-fx17-s2', 'zz-fx17-PLAIN', 'v2', false)");
await pool.query(
  "INSERT INTO agent_tokens (id, label, scope, token_hash) VALUES ('zz-fx17-t1', 'zz-fx17-old-token', 'author', 'zz-fx17-hash')"
);

await initDb();

await check("D-8: the deployer of the oldest version owns it, when they are a creator", async () => {
  assert.equal(await ownerOf(byDeployer), secondCreator);
});

await check("D-8: a deployer who no longer exists, or is not a creator, falls back to the first creator", async () => {
  assert.equal(await ownerOf(byGhost), firstCreator);
  assert.equal(await ownerOf(byViewer), firstCreator);
  assert.equal(await ownerOf(byMigration), firstCreator);
});

await check("D-6: every existing secret was copied to every creator", async () => {
  const { rows } = await pool.query(
    "SELECT key, value, is_secret, owner_id FROM secrets WHERE key LIKE 'zz-fx17-%' ORDER BY key, owner_id"
  );
  assert.equal(rows.length, 4);
  for (const owner of [firstCreator, secondCreator]) {
    const mine = rows.filter((row) => row.owner_id === owner);
    assert.deepEqual(mine.map((row) => [row.key, row.value, row.is_secret]), [
      ["zz-fx17-API", "v1", true],
      ["zz-fx17-PLAIN", "v2", false],
    ]);
  }
});

await check("D-6: the same key may now exist once per owner, and only once", async () => {
  await assert.rejects(
    pool.query(
      "INSERT INTO secrets (id, key, value, is_secret, owner_id) VALUES ('zz-fx17-dup', 'zz-fx17-API', 'x', true, $1)",
      [firstCreator]
    ),
    /unique/i
  );
});

await check("D-9: an existing agent token goes to the first creator", async () => {
  const { rows } = await pool.query("SELECT user_id FROM agent_tokens WHERE id = 'zz-fx17-t1'");
  assert.equal(rows[0].user_id, firstCreator);
});

await check("initDb twice in a row changes nothing", async () => {
  const before = await pool.query("SELECT count(*)::int AS n FROM secrets WHERE key LIKE 'zz-fx17-%'");
  await initDb();
  await initDb();
  const after = await pool.query("SELECT count(*)::int AS n FROM secrets WHERE key LIKE 'zz-fx17-%'");
  assert.equal(after.rows[0].n, before.rows[0].n);
  assert.equal(await ownerOf(byDeployer), secondCreator);
});

await check("D-8 / D-6: with no creator at all the owner is NULL and no secret is deleted", async () => {
  await clean();
  await legacySchema();
  const creators = (await pool.query("UPDATE users SET role = 'viewer' WHERE role = 'creator' RETURNING id")).rows.map((row) => row.id as string);
  const lonely = await seedNotebook("m-lonely", "zz-fx17-nobody");
  await pool.query("INSERT INTO secrets (id, key, value, is_secret) VALUES ('zz-fx17-s3', 'zz-fx17-ORPHAN', 'v3', true)");
  await initDb();
  assert.equal(await ownerOf(lonely), null);
  const { rows } = await pool.query("SELECT owner_id FROM secrets WHERE key = 'zz-fx17-ORPHAN'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner_id, null);
  await pool.query("UPDATE users SET role = 'creator' WHERE id = ANY($1)", [creators]);
});

await clean();

// ── the cast ──────────────────────────────────────────────────────────────────
//
// Five people and the notebooks they stand in front of. `owner` made them; `editor` was
// invited; `other` is a creator with no part in them; `viewer` has a viewer account; and
// `chosen` is a viewer the owner named for the `selected` app.

interface Person {
  id: string;
  username: string;
  token: string;
  headers: Record<string, string>;
}

async function person(name: string, role: "creator" | "viewer"): Promise<Person> {
  const created = await authService.createUser(`zz-fx17-${name}`, PASSWORD, role);
  const token = (await authService.login(`zz-fx17-${name}`, PASSWORD)).token;
  return { id: created.id, username: created.username, token, headers: { Authorization: `Bearer ${token}` } };
}

const owner = await person("owner", "creator");
const editor = await person("editor", "creator");
const other = await person("other", "creator");
const viewer = await person("viewer", "viewer");
const chosen = await person("chosen", "viewer");

interface Seed {
  owner: Person | null;
  /** A deployed version of the same document, or the notebook stays a draft. */
  deployed?: boolean;
  visibility?: "all" | "selected";
  editors?: Person[];
  appUsers?: Person[];
}

/** A notebook made straight in the tables, so the access rule is tested on its own. */
async function seed(name: string, options: Seed): Promise<string> {
  const id = `zz-fx17-nb-${name}`;
  const document = {
    version: "1.0",
    id,
    name: `zz-fx17-${name}`,
    runtime: "node",
    outputs: ["answer"],
    steps: [{ id: `cell-${name}`, kind: "cell", code: `return { answer: '${name}-source-marker' };` }],
  };
  await pool.query(
    "INSERT INTO notebooks (id, name, runtime, document, owner_id, app_visibility) VALUES ($1, $2, 'node', $3, $4, $5)",
    [id, document.name, JSON.stringify(document), options.owner?.id ?? null, options.visibility ?? "all"]
  );
  if (options.deployed) {
    await pool.query(
      "INSERT INTO notebook_versions (id, notebook_id, document, deployed_by) VALUES ($1, $2, $3, 'zz-fx17-owner')",
      [`zz-fx17-v-${name}`, id, JSON.stringify(document)]
    );
    await pool.query("UPDATE notebooks SET deployed_version_id = $1 WHERE id = $2", [`zz-fx17-v-${name}`, id]);
  }
  for (const who of options.editors ?? []) {
    await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'editor')", [id, who.id]);
  }
  for (const who of options.appUsers ?? []) {
    await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'app')", [id, who.id]);
  }
  return id;
}

const everyone = await seed("open", { owner, deployed: true, editors: [editor] });
const picked = await seed("picked", { owner, deployed: true, visibility: "selected", editors: [editor], appUsers: [chosen] });
const draft = await seed("draft", { owner, editors: [editor], appUsers: [chosen] });
const ownerless = await seed("ownerless", { owner: null, deployed: true });

// ── the access module (T-02) ──────────────────────────────────────────────────

console.log("\nwhat a person is to a notebook");

const access = notebookAccessService;

await check("an app open to everyone: owner, editor, and everybody else as a page user", async () => {
  assert.equal(await access.accessFor(owner.id, everyone), "owner");
  assert.equal(await access.accessFor(editor.id, everyone), "editor");
  assert.equal(await access.accessFor(other.id, everyone), "app");
  assert.equal(await access.accessFor(viewer.id, everyone), "app");
  assert.equal(await access.accessFor(chosen.id, everyone), "app");
});

await check("an app for selected people: only those named, besides owner and editor", async () => {
  assert.equal(await access.accessFor(owner.id, picked), "owner");
  assert.equal(await access.accessFor(editor.id, picked), "editor");
  assert.equal(await access.accessFor(chosen.id, picked), "app");
  assert.equal(await access.accessFor(other.id, picked), null);
  assert.equal(await access.accessFor(viewer.id, picked), null);
});

await check("a draft is nobody's page: owner and editor reach it, everyone else gets nothing", async () => {
  assert.equal(await access.accessFor(owner.id, draft), "owner");
  assert.equal(await access.accessFor(editor.id, draft), "editor");
  assert.equal(await access.accessFor(other.id, draft), null);
  assert.equal(await access.accessFor(viewer.id, draft), null);
  assert.equal(await access.accessFor(chosen.id, draft), null);
  assert.equal(await access.canUseApp(owner.id, draft), false, "an undeployed notebook has no app to use");
});

await check("a notebook that does not exist answers exactly like one that is hidden", async () => {
  assert.equal(await access.accessFor(other.id, picked), await access.accessFor(other.id, "zz-fx17-no-such-notebook"));
});

await check("only a creator is ever owner or editor: a viewer holding an editor row is not one", async () => {
  await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'editor')", [draft, viewer.id]);
  assert.equal(await access.accessFor(viewer.id, draft), null);
  assert.equal(await access.canEdit(viewer.id, draft), false);
  await pool.query("DELETE FROM notebook_access WHERE notebook_id = $1 AND user_id = $2", [draft, viewer.id]);
});

await check("a deactivated account is nothing to anyone", async () => {
  await authService.setActive(editor.id, false);
  assert.equal(await access.accessFor(editor.id, everyone), null);
  await authService.setActive(editor.id, true);
  assert.equal(await access.accessFor(editor.id, everyone), "editor");
});

await check("a notebook without an owner is reachable only as a page", async () => {
  assert.equal(await access.accessFor(owner.id, ownerless), "app");
  assert.equal(await access.canEdit(owner.id, ownerless), false);
  assert.equal(await access.ownerOf(ownerless), null);
});

await check("the lists the screens are built from follow the same rule", async () => {
  const mine = (await access.editableIds(owner.id)).filter((id) => id.startsWith("zz-fx17-nb-")).sort();
  assert.deepEqual(mine, [draft, everyone, picked].sort());
  assert.deepEqual((await access.editableIds(other.id)).filter((id) => id.startsWith("zz-fx17-nb-")), []);

  const apps = (await access.appIds(viewer.id)).filter((id) => id.startsWith("zz-fx17-nb-")).sort();
  assert.deepEqual(apps, [everyone, ownerless].sort());
  const chosenApps = (await access.appIds(chosen.id)).filter((id) => id.startsWith("zz-fx17-nb-")).sort();
  assert.deepEqual(chosenApps, [everyone, ownerless, picked].sort());
});

await check("run history: the team reads every run, a page user their own, anyone else none", async () => {
  assert.equal(await access.runScope(owner.id, everyone), "all");
  assert.equal(await access.runScope(editor.id, everyone), "all");
  assert.equal(await access.runScope(viewer.id, everyone), "own");
  assert.equal(await access.runScope(other.id, picked), "none");
  assert.equal(await access.canSeeRun(viewer.id, { notebook_id: everyone, started_by: viewer.id }), true);
  assert.equal(await access.canSeeRun(viewer.id, { notebook_id: everyone, started_by: other.id }), false);
  assert.equal(await access.canSeeRun(viewer.id, { notebook_id: everyone, started_by: null }), false);
  assert.equal(await access.canSeeRun(owner.id, { notebook_id: everyone, started_by: null }), true);
});

// ── finish ──
console.log(`\n${passed} passed, ${failed} failed`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);

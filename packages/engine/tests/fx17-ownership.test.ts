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
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { notebookSharesService } from "../src/services/notebook-shares.service.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";
import { notebookAccessService } from "../src/services/notebook-access.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import type { NotebookJson } from "@zaa-tool/shared";

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
  await pool.query("DELETE FROM secrets WHERE key ILIKE 'zz%fx17%'");
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
  /** More front matter for the document, to give a notebook something worth hiding. */
  extra?: Record<string, unknown>;
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
    ...options.extra,
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

// ── REST (T-03) ───────────────────────────────────────────────────────────────

const hub = new RunEventHub();
const server = http.createServer(createApp((event) => hub.publish(event)));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(who: Person, method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${url}`, {
    method,
    headers: { ...who.headers, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for a run to end, reading it as its owner so the wait itself is never refused. */
async function finished(notebookId: string, runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await pool.query("SELECT status FROM notebook_runs WHERE id = $1", [runId]);
    if (rows[0] && rows[0].status !== "running") return;
    await sleep(100);
  }
  throw new Error(`run ${runId} of ${notebookId} did not finish`);
}

const actors: [string, Person][] = [
  ["owner", owner],
  ["editor", editor],
  ["other creator", other],
  ["viewer", viewer],
  ["chosen viewer", chosen],
];

console.log("\nwho sees what over REST — an app open to everyone");

await check("the editor's notebook list holds only what the caller owns or was invited to", async () => {
  const expected: Record<string, boolean> = { owner: true, editor: true, "other creator": false, viewer: false, "chosen viewer": false };
  for (const [label, who] of actors) {
    const res = await call(who, "GET", "/api/notebooks");
    assert.equal(res.status, 200, label);
    const ids = ((await res.json()) as { id: string }[]).map((row) => row.id);
    for (const id of [everyone, picked, draft]) assert.equal(ids.includes(id), expected[label], `${label} / ${id}`);
  }
});

await check("the source is the team's: owner and editor read it, everybody else is told there is no such notebook", async () => {
  for (const id of [everyone, picked, draft]) {
    for (const [label, who] of actors) {
      const team = label === "owner" || label === "editor";
      for (const url of [`/api/notebooks/${id}`, `/api/notebooks/${id}/text`, `/api/notebooks/${id}/deploy`]) {
        const res = await call(who, "GET", url);
        assert.equal(res.status, team ? 200 : 404, `${label} GET ${url}`);
        if (!team) assert.deepEqual(await res.json(), { error: "Notebook not found" }, `${label} ${url}`);
      }
    }
  }
});

await check("INV-7: a hidden notebook and a missing one are the same answer, byte for byte", async () => {
  const hidden = await call(other, "GET", `/api/notebooks/${picked}`);
  const missing = await call(other, "GET", `/api/notebooks/zz-fx17-no-such-notebook`);
  assert.equal(hidden.status, missing.status);
  assert.equal(await hidden.text(), await missing.text());
  for (const [method, url] of [["POST", `/api/notebooks/${picked}/duplicate`], ["POST", `/api/notebooks/${picked}/deploy`], ["DELETE", `/api/notebooks/${picked}`]] as const) {
    const a = await call(other, method, url);
    const b = await call(other, method, url.replace(picked, "zz-fx17-no-such-notebook"));
    assert.equal(a.status, b.status, `${method} ${url}`);
    assert.equal(await a.text(), await b.text(), `${method} ${url}`);
  }
});

await check("deleting is the owner's alone: an editor is refused, anyone else is told it does not exist", async () => {
  const mine = await seed("deletable", { owner, deployed: true, editors: [editor] });
  assert.equal((await call(editor, "DELETE", `/api/notebooks/${mine}`)).status, 403);
  assert.equal((await call(other, "DELETE", `/api/notebooks/${mine}`)).status, 404);
  assert.equal((await call(chosen, "DELETE", `/api/notebooks/${mine}`)).status, 403, "role guard first for a viewer account");
  assert.equal((await pool.query("SELECT 1 FROM notebooks WHERE id = $1", [mine])).rowCount, 1);
  assert.equal((await call(owner, "DELETE", `/api/notebooks/${mine}`)).status, 200);
  assert.equal((await pool.query("SELECT 1 FROM notebooks WHERE id = $1", [mine])).rowCount, 0);
});

await check("deploy and undeploy are the team's", async () => {
  const mine = await seed("deploys", { owner, editors: [editor] });
  assert.equal((await call(other, "POST", `/api/notebooks/${mine}/deploy`)).status, 404);
  assert.equal((await call(other, "DELETE", `/api/notebooks/${mine}/deploy`)).status, 404);
  assert.equal((await call(editor, "POST", `/api/notebooks/${mine}/deploy`)).status, 200);
  assert.equal((await call(editor, "DELETE", `/api/notebooks/${mine}/deploy`)).status, 200);
});

await check("sharing a link, listing runs and clearing them are the team's too", async () => {
  for (const [method, url] of [
    ["GET", `/api/notebooks/${everyone}/shares`],
    ["POST", `/api/notebooks/${everyone}/shares`],
    ["DELETE", `/api/notebooks/${everyone}/runs`],
  ] as const) {
    assert.equal((await call(other, method, url)).status, 404, `other ${method} ${url}`);
    assert.equal((await call(editor, method, url)).status, 200, `editor ${method} ${url}`);
  }
});

await check("a share link can only be revoked under the notebook it belongs to", async () => {
  const share = (await (await call(owner, "POST", `/api/notebooks/${everyone}/shares`)).json()) as { id: string };
  const mine = await seed("revoker", { owner, deployed: true });
  await call(owner, "DELETE", `/api/notebooks/${mine}/shares/${share.id}`);
  assert.equal((await notebookSharesService.listByNotebook(everyone)).some((row) => row.id === share.id), true, "ended through another notebook");
  await call(owner, "DELETE", `/api/notebooks/${everyone}/shares/${share.id}`);
  assert.equal((await notebookSharesService.listByNotebook(everyone)).some((row) => row.id === share.id), false);
});

console.log("\nthe app: used by many, read by none");

await check("the Apps list: an open app is everybody's, a selected one belongs to the people named", async () => {
  for (const [label, who] of actors) {
    const res = await call(who, "GET", "/api/notebooks/pages");
    assert.equal(res.status, 200, label);
    const ids = ((await res.json()) as { id: string }[]).map((page) => page.id);
    assert.equal(ids.includes(everyone), true, `${label} sees the open app`);
    const sees = label === "owner" || label === "editor" || label === "chosen viewer";
    assert.equal(ids.includes(picked), sees, `${label} / selected app`);
    assert.equal(ids.includes(draft), false, `${label} / a draft is not an app`);
  }
});

await check("D-5: a page user's /deployed is the page — no cell, setup, secret name, trigger or package", async () => {
  const leaky = await seed("leaky", {
    editors: [editor],
    owner,
    deployed: true,
    extra: { secrets: ["zz-fx17-HIDDEN-NAME"], triggers: [{ id: "zz-fx17-trig", kind: "cron", cron: "0 3 * * *" }], packages: ["zz-fx17-pkg"], setup: "zz-fx17-setup-text" },
  });
  const team = await (await call(editor, "GET", `/api/notebooks/${leaky}/deployed`)).json();
  assert.ok(Array.isArray(team.steps) && team.steps.length > 0, "the editor gets the document");

  for (const who of [other, viewer, chosen]) {
    const res = await call(who, "GET", `/api/notebooks/${leaky}/deployed`);
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const secret of ["source-marker", "zz-fx17-HIDDEN-NAME", "zz-fx17-trig", "zz-fx17-pkg", "zz-fx17-setup-text", "steps", "triggers", "secrets", "packages", "\"code\""]) {
      assert.ok(!text.includes(secret), `a page user received ${secret}`);
    }
    const page = JSON.parse(text);
    assert.equal(page.id, leaky);
    assert.deepEqual(page.outputs.map((output: { name: string }) => output.name), ["answer"]);
  }
});

await check("a selected app is a 404 to anyone not named, even on /deployed", async () => {
  assert.equal((await call(other, "GET", `/api/notebooks/${picked}/deployed`)).status, 404);
  assert.equal((await call(viewer, "GET", `/api/notebooks/${picked}/deployed`)).status, 404);
  assert.equal((await call(chosen, "GET", `/api/notebooks/${picked}/deployed`)).status, 200);
});

console.log("\nrunning, and whose runs are whose");

const runIds: Record<string, string> = {};

await check("owner and editor run the draft; a page user runs the deployed version; a stranger is told 404", async () => {
  for (const [label, who] of actors) {
    const res = await call(who, "POST", `/api/notebooks/${picked}/run`, {});
    const allowed = label === "owner" || label === "editor" || label === "chosen viewer";
    assert.equal(res.status, allowed ? 200 : 404, label);
    if (allowed) {
      runIds[label] = ((await res.json()) as { runId: string }).runId;
      await finished(picked, runIds[label]);
    }
  }
  const { rows } = await pool.query("SELECT id, started_by, trigger_source FROM notebook_runs WHERE id = ANY($1)", [Object.values(runIds)]);
  const by = (label: string) => rows.find((row) => row.id === runIds[label]);
  assert.equal(by("owner").started_by, owner.id);
  assert.equal(by("editor").started_by, editor.id);
  assert.equal(by("chosen viewer").started_by, chosen.id);
  assert.equal(by("chosen viewer").trigger_source, "page", "a page user's run is the deployed page");
  assert.notEqual(by("owner").trigger_source, "page");
});

await check("a creator who only uses somebody else's app is held to the page exactly like a viewer", async () => {
  const res = await call(other, "POST", `/api/notebooks/${everyone}/run`, { input: { x: 1 } });
  assert.equal(res.status, 403);
  const ok = await call(other, "POST", `/api/notebooks/${everyone}/run`, {});
  assert.equal(ok.status, 200);
  const runId = ((await ok.json()) as { runId: string }).runId;
  await finished(everyone, runId);
  const { rows } = await pool.query("SELECT trigger_source FROM notebook_runs WHERE id = $1", [runId]);
  assert.equal(rows[0].trigger_source, "page", "a creator with no part in it ran the draft");
});

await check("run history: the team reads every run, a page user only their own, a stranger none", async () => {
  const ids = async (who: Person) => ((await (await call(who, "GET", `/api/notebooks/${picked}/runs`)).json()) as { id: string }[]).map((row) => row.id);
  const teamSees = await ids(owner);
  for (const label of ["owner", "editor", "chosen viewer"]) assert.ok(teamSees.includes(runIds[label]), `owner sees ${label}'s run`);
  assert.deepEqual((await ids(editor)).sort(), teamSees.sort());
  assert.deepEqual(await ids(chosen), [runIds["chosen viewer"]]);
  assert.equal((await call(other, "GET", `/api/notebooks/${picked}/runs`)).status, 404);
});

await check("a run is readable by id only by whoever may see that run", async () => {
  assert.equal((await call(owner, "GET", `/api/notebooks/${picked}/runs/${runIds["chosen viewer"]}`)).status, 200);
  assert.equal((await call(chosen, "GET", `/api/notebooks/${picked}/runs/${runIds["chosen viewer"]}`)).status, 200);
  assert.equal((await call(chosen, "GET", `/api/notebooks/${picked}/runs/${runIds["owner"]}`)).status, 404);
  assert.equal((await call(chosen, "GET", `/api/notebooks/${picked}/runs/latest`)).status, 200);
  assert.equal((await call(other, "GET", `/api/notebooks/${picked}/runs/${runIds["owner"]}`)).status, 404);
  const latest = await (await call(chosen, "GET", `/api/notebooks/${picked}/runs/latest`)).json();
  assert.equal(latest.id, runIds["chosen viewer"], "'latest' for a page user is their latest, not the team's");
});

await check("a run nobody started (a schedule, a webhook, a link) is the team's to read", async () => {
  await pool.query("INSERT INTO notebook_runs (id, notebook_id, status, trigger_source) VALUES ('zz-fx17-run-cron', $1, 'success', 'cron')", [picked]);
  assert.equal((await call(owner, "GET", `/api/notebooks/${picked}/runs/zz-fx17-run-cron`)).status, 200);
  assert.equal((await call(chosen, "GET", `/api/notebooks/${picked}/runs/zz-fx17-run-cron`)).status, 404);
});

await check("cancelling a run is the team's", async () => {
  await pool.query("INSERT INTO notebook_runs (id, notebook_id, status, trigger_source, started_by) VALUES ('zz-fx17-run-live', $1, 'running', 'page', $2)", [picked, chosen.id]);
  assert.equal((await call(other, "POST", `/api/notebooks/${picked}/runs/zz-fx17-run-live/cancel`)).status, 404);
  assert.notEqual((await call(editor, "POST", `/api/notebooks/${picked}/runs/zz-fx17-run-live/cancel`)).status, 404);
});

console.log("\nwriting");

const newDoc = (name: string, id = "") => ({
  version: "1.0",
  id,
  name,
  runtime: "node",
  steps: [{ id: `cell-${name}`, kind: "cell", code: "return {};" }],
});

await check("a new notebook belongs to whoever made it; saving over it never changes that", async () => {
  const made = (await (await call(other, "POST", "/api/notebooks", newDoc("zz-fx17-made"))).json()) as { id: string };
  assert.equal(await access.ownerOf(made.id), other.id);
  assert.equal(await access.accessFor(owner.id, made.id), null);
  await call(other, "POST", "/api/notebooks", newDoc("zz-fx17-made-renamed", made.id));
  assert.equal(await access.ownerOf(made.id), other.id);
});

await check("saving over a notebook you cannot see is answered like saving a new id, and changes nothing", async () => {
  const before = await pool.query("SELECT document, owner_id FROM notebooks WHERE id = $1", [picked]);
  const res = await call(other, "POST", "/api/notebooks", newDoc("zz-fx17-takeover", picked));
  assert.equal(res.status, 404);
  const after = await pool.query("SELECT document, owner_id FROM notebooks WHERE id = $1", [picked]);
  assert.equal(after.rows[0].document, before.rows[0].document);
  assert.equal(after.rows[0].owner_id, owner.id);
});

await check("an editor saves over the owner's notebook and the owner stays the owner", async () => {
  const res = await call(editor, "POST", "/api/notebooks", { ...(JSON.parse((await pool.query("SELECT document FROM notebooks WHERE id = $1", [draft])).rows[0].document)), tags: ["zz-fx17-tag"] });
  assert.equal(res.status, 200);
  assert.equal(await access.ownerOf(draft), owner.id);
});

await check("importing text that names somebody else's id changes nothing and says nothing", async () => {
  const text = (await (await call(owner, "GET", `/api/notebooks/${picked}/text`)).text());
  const res = await call(other, "POST", "/api/notebooks/text", { text });
  assert.equal(res.status, 404);
  const asNew = await call(other, "POST", "/api/notebooks/text", { text, asNew: true });
  assert.equal(asNew.status, 200);
  const made = (await asNew.json()) as { id: string };
  assert.equal(await access.ownerOf(made.id), other.id);
});

await check("a duplicate belongs to whoever copied it, and its name ignores notebooks they cannot see", async () => {
  assert.equal((await call(other, "POST", `/api/notebooks/${picked}/duplicate`)).status, 404);
  const mine = await seed("dupe-src", { owner, editors: [editor] });
  await seed("dupe-src-copy", { owner: other });
  const copy = (await (await call(editor, "POST", `/api/notebooks/${mine}/duplicate`)).json()) as { id: string; name: string };
  assert.equal(await access.ownerOf(copy.id), editor.id);
  assert.equal(copy.name, "zz-fx17-dupe-src-copy", "another owner's notebook is not 'taken' for the editor");
});

await check("the system map only draws notebooks the caller may open", async () => {
  const names = async (who: Person) => JSON.stringify(await (await call(who, "GET", "/api/notebooks/map")).json());
  assert.ok((await names(owner)).includes("zz-fx17-open"));
  assert.ok(!(await names(other)).includes("zz-fx17-open"));
  assert.ok(!(await names(viewer)).includes("zz-fx17-open"));
});

await check("a page's file picker works for whoever may run the page, and for no one else", async () => {
  const form = () => {
    const data = new FormData();
    data.append("file", new Blob(["hello"], { type: "text/plain" }), "zz-fx17.txt");
    return data;
  };
  const up = (who: Person, id: string) => fetch(`${base}/api/notebooks/${id}/uploads`, { method: "POST", headers: who.headers, body: form() });
  assert.equal((await up(chosen, picked)).status, 200);
  assert.equal((await up(other, picked)).status, 404);
  assert.equal((await up(other, everyone)).status, 200);
  fs.rmSync(path.join(STORAGE_DIR, "uploads", picked), { recursive: true, force: true });
  fs.rmSync(path.join(STORAGE_DIR, "uploads", everyone), { recursive: true, force: true });
});

// ── secrets belong to whoever made them (T-04) ────────────────────────────────

console.log("\nsecrets");

async function putSecret(who: Person, key: string, value: string): Promise<Response> {
  return call(who, "POST", "/api/resources/secrets", { key, value, is_secret: true });
}

/** A notebook that reports the secret it was given, stored through the service. */
async function reporter(name: string, who: Person, key: string, extra: Record<string, unknown> = {}): Promise<string> {
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name: `zz-fx17-${name}`,
      runtime: "node",
      secrets: [key],
      outputs: ["got"],
      steps: [{ id: `cell-${name}`, kind: "cell", code: `return { got: process.env.${key} ?? null };` }],
      ...extra,
    } as NotebookJson,
    "test",
    who.id
  );
  return saved.id;
}

async function gotFrom(notebookId: string, runId: string): Promise<unknown> {
  await finished(notebookId, runId);
  const { rows } = await pool.query("SELECT cell_results FROM notebook_runs WHERE id = $1", [runId]);
  const cell = Object.values(rows[0].cell_results as Record<string, { output?: { got?: unknown } }>)[0];
  return cell?.output?.got;
}

await check("each account lists only its own secrets, and the same key may exist once per account", async () => {
  assert.equal((await putSecret(owner, "ZZ_FX17_TOKEN", "owner-value")).status, 200);
  assert.equal((await putSecret(editor, "ZZ_FX17_TOKEN", "editor-value")).status, 200);
  assert.equal((await putSecret(other, "ZZ_FX17_ONLY_OTHER", "other-value")).status, 200);

  const keys = async (who: Person) => ((await (await call(who, "GET", "/api/resources/secrets")).json()) as { key: string }[]).map((row) => row.key).sort();
  assert.deepEqual(await keys(owner), ["ZZ_FX17_TOKEN"]);
  assert.deepEqual(await keys(editor), ["ZZ_FX17_TOKEN"]);
  assert.deepEqual(await keys(other), ["ZZ_FX17_ONLY_OTHER"]);
  assert.equal((await putSecret(owner, "ZZ_FX17_TOKEN", "again")).status, 409, "the same key twice for one account");
});

await check("an editor cannot read, change or delete the owner's secret through the API", async () => {
  const ownerRow = (await (await call(owner, "GET", "/api/resources/secrets")).json())[0] as { id: string; value: string };
  assert.equal(ownerRow.value, "******");
  assert.equal((await call(editor, "PUT", `/api/resources/secrets/${ownerRow.id}`, { key: "ZZ_FX17_TOKEN", value: "stolen", is_secret: true })).status, 404);
  await call(editor, "DELETE", `/api/resources/secrets/${ownerRow.id}`);
  const { rows } = await pool.query("SELECT value FROM secrets WHERE id = $1", [ownerRow.id]);
  assert.equal(rows[0]?.value, "owner-value", "the owner's secret was changed or deleted by somebody else");
});

await check("D-6/D-7: a notebook runs with its owner's secret, whoever presses Run — an editor's own value is not used", async () => {
  const id = await reporter("secret-owner", owner, "ZZ_FX17_TOKEN");
  await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'editor')", [id, editor.id]);

  const byOwner = (await (await call(owner, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, byOwner.runId), "owner-value");
  const byEditor = (await (await call(editor, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, byEditor.runId), "owner-value", "the editor's run used the editor's secret");
});

await check("a notebook cannot use another account's secret that its owner does not have", async () => {
  const id = await reporter("secret-borrow", owner, "ZZ_FX17_ONLY_OTHER");
  const run = (await (await call(owner, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, run.runId), null);
});

await check("an editor's own notebook uses the editor's secret, not the owner's with the same key", async () => {
  const id = await reporter("secret-editors", editor, "ZZ_FX17_TOKEN");
  const run = (await (await call(editor, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, run.runId), "editor-value");
});

await check("a webhook guarded by a secret key is guarded by the notebook owner's value", async () => {
  await putSecret(owner, "ZZ_FX17_HOOK", "hook-owner");
  await putSecret(editor, "ZZ_FX17_HOOK", "hook-editor");
  const slug = "zz-fx17-hook-slug-guarded-owner";
  const id = await reporter("hooked", owner, "ZZ_FX17_HOOK", {
    triggers: [{ id: "zz-fx17-hook-t", kind: "webhook", slug, secretKey: "ZZ_FX17_HOOK" }],
  });
  await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'editor')", [id, editor.id]);
  assert.equal((await call(editor, "POST", `/api/notebooks/${id}/deploy`)).status, 200);

  const hook = (secret: string) => fetch(`${base}/hooks/${slug}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret }, body: "{}" });
  assert.equal((await hook("hook-editor")).status, 401, "the editor's own value opened the owner's webhook");
  const ok = await hook("hook-owner");
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { outputs: { got: string } }).outputs.got, "hook-owner");
});

// ── next ──
server.close();

// ── finish ──
console.log(`\n${passed} passed, ${failed} failed`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);

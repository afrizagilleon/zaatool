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
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { agentTokensService } from "../src/services/agent-tokens.service.js";
import { toolNameFor } from "../src/core/notebook-tool-name.js";
import { WebSocket } from "ws";
import { WebSocketManager } from "../src/server/websocket-manager.js";
import { createApp } from "../src/server/app.js";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { notebookSharesService } from "../src/services/notebook-shares.service.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";
import { notebookAccessService } from "../src/services/notebook-access.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import type { NotebookJson } from "@zaa-tool/shared";
import { activeSandboxConfig, secretsKey } from "../src/config.js";
import { NotebookWithoutOwnerError } from "../src/services/cell-host.service.js";
import { decryptValue } from "../src/core/secrets-crypto.js";

/**
 * A secret value as its owner would read it. Since FX-19 the column holds ciphertext whenever
 * SECRETS_KEY is set (production), so a raw SELECT is only the plaintext in development.
 */
async function storedSecret(where: string, params: unknown[]): Promise<string | undefined> {
  const { rows } = await pool.query(`SELECT value, owner_id, key FROM secrets WHERE ${where}`, params);
  const row = rows[0] as { value: string; owner_id: string; key: string } | undefined;
  if (!row) return undefined;
  const key = secretsKey();
  return key ? decryptValue(key, row.owner_id, row.key, row.value) : row.value;
}

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
  const mineOnly = rows.filter((row) => row.owner_id === firstCreator || row.owner_id === secondCreator);
  assert.equal(mineOnly.length, 4);
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
  // Switching an account off ends its sessions (FX-18), and switching it back on does not
  // bring them back: the editor signs in again, as a person would.
  editor.token = (await authService.login(editor.username, PASSWORD)).token;
  editor.headers = { Authorization: `Bearer ${editor.token}` };
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
  const asNew = await call(other, "POST", "/api/notebooks/text", { text: text.replace("name: zz-fx17-picked", "name: zz-fx17-imported"), asNew: true });
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

/**
 * What a notebook that reports its secret is expected to report. The value itself would be
 * redacted from the run (that is the point of L-06), so the cell hands back the value
 * *reversed*, which no redaction pattern matches and which still says exactly which secret it got.
 */
const rev = (value: string): string => [...value].reverse().join("");

/** A notebook that reports the secret it was given (reversed, see `rev`), stored through the service. */
async function reporter(name: string, who: Person, key: string, extra: Record<string, unknown> = {}): Promise<string> {
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name: `zz-fx17-${name}`,
      runtime: "node",
      secrets: [key],
      outputs: ["got"],
      steps: [{ id: `cell-${name}`, kind: "cell", code: `const v = process.env.${key}; return { got: v == null ? null : [...v].reverse().join('') };` }],
      ...extra,
    } as NotebookJson,
    "test",
    who.id
  );
  return saved.id;
}

async function gotFrom(notebookId: string, runId: string): Promise<unknown> {
  await finished(notebookId, runId);
  // The run is marked finished a moment before its last cell's result is written, so on a
  // busy machine the first read can be of a run with no results yet. Wait for one.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await pool.query("SELECT cell_results FROM notebook_runs WHERE id = $1", [runId]);
    const cell = Object.values(rows[0].cell_results as Record<string, { output?: { got?: unknown } }>)[0];
    if (cell?.output !== undefined) return cell.output.got;
    await sleep(100);
  }
  return undefined;
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
  assert.equal(await storedSecret("id = $1", [ownerRow.id]), "owner-value", "the owner's secret was changed or deleted by somebody else");
});

await check("D-6/D-7 (L-01): the owner's run uses the owner's secret, an editor's draft run uses the editor's own, never the owner's", async () => {
  const id = await reporter("secret-owner", owner, "ZZ_FX17_TOKEN");
  await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'editor')", [id, editor.id]);

  const byOwner = (await (await call(owner, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, byOwner.runId), rev("owner-value"));
  const byEditor = (await (await call(editor, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, byEditor.runId), rev("editor-value"), "the editor's draft run was handed the owner's secret");
});

await check("a notebook cannot use another account's secret that its owner does not have", async () => {
  const id = await reporter("secret-borrow", owner, "ZZ_FX17_ONLY_OTHER");
  const run = (await (await call(owner, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, run.runId), null);
});

await check("an editor's own notebook uses the editor's secret, not the owner's with the same key", async () => {
  const id = await reporter("secret-editors", editor, "ZZ_FX17_TOKEN");
  const run = (await (await call(editor, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, run.runId), rev("editor-value"));
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
  assert.equal(((await ok.json()) as { outputs: { got: string } }).outputs.got, rev("hook-owner"));
});

// ── nested calls and buttons (T-05) ───────────────────────────────────────────

console.log("\nnotebooks that call notebooks");

async function setVisibility(id: string, visibility: "all" | "selected", appUsers: Person[] = []): Promise<void> {
  await pool.query("UPDATE notebooks SET app_visibility = $1 WHERE id = $2", [visibility, id]);
  await pool.query("DELETE FROM notebook_access WHERE notebook_id = $1 AND permission = 'app'", [id]);
  for (const who of appUsers) {
    await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'app')", [id, who.id]);
  }
}

/** A notebook that calls another by name and reports what came back, or why it did not. */
async function caller(name: string, who: Person, callee: string, extra: Record<string, unknown> = {}): Promise<string> {
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name: `zz-fx17-${name}`,
      runtime: "node",
      outputs: ["got"],
      steps: [
        {
          id: `cell-${name}`,
          kind: "cell",
          code: `try { const r = await notebooks.run('${callee}', {}); return { got: r.got }; } catch (e) { return { got: 'ERR:' + e.message }; }`,
        },
      ],
      ...extra,
    } as NotebookJson,
    "test",
    who.id
  );
  return saved.id;
}

await check("D-12 (L-01): a call reaches an app open to everybody; the callee gets its owner's secret in production, and the starter's (here none) in a draft run", async () => {
  const callee = await reporter("callee-open", other, "ZZ_FX17_ONLY_OTHER");
  await notebooksService.deploy(callee, "test");
  const from = await caller("caller-open", owner, "zz-fx17-callee-open");

  // A draft run is the starter's own: the callee's owner's secret is not handed to a draft run
  // of somebody else's notebook.
  const run = (await (await call(owner, "POST", `/api/notebooks/${from}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(from, run.runId), null, "a draft run was handed the callee owner's secret");
  // Deployed, the page runs production: the callee's owner approved what the callee does.
  await notebooksService.deploy(from, "test");
  const page = (await (await call(viewer, "POST", `/api/notebooks/${from}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(from, page.runId), rev("other-value"), "the callee did not use its own owner's secret in production");
});

await check("D-12: an app for selected people that does not include the caller's owner is not found — a draft run and a deployed run alike", async () => {
  const callee = await reporter("callee-picked", other, "ZZ_FX17_ONLY_OTHER");
  await notebooksService.deploy(callee, "test");
  await setVisibility(callee, "selected", [chosen]);
  const from = await caller("caller-picked", owner, "zz-fx17-callee-picked");

  const draftRun = (await (await call(owner, "POST", `/api/notebooks/${from}/run`, {})).json()) as { runId: string };
  assert.match(String(await gotFrom(from, draftRun.runId)), /^ERR:.*not found/i);

  await notebooksService.deploy(from, "test");
  const pageRun = (await (await call(viewer, "POST", `/api/notebooks/${from}/run`, {})).json()) as { runId: string };
  { const got = String(await gotFrom(from, pageRun.runId)); assert.match(got, /^ERR:.*not found/i, `the page run reached a callee its owner cannot: ${got}`); }

  await setVisibility(callee, "selected", [owner]);
  const allowed = (await (await call(viewer, "POST", `/api/notebooks/${from}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(from, allowed.runId), rev("other-value"), "naming the caller's owner should open the callee");
});

await check("D-12: it is not found whether the callee is hidden or does not exist — the message does not tell them apart", async () => {
  const hidden = await caller("caller-hidden", owner, "zz-fx17-callee-picked");
  const missing = await caller("caller-missing", owner, "zz-fx17-callee-picked-x");
  const callee = (await pool.query("SELECT id FROM notebooks WHERE name = 'zz-fx17-callee-picked'")).rows[0].id as string;
  await setVisibility(callee, "selected", [chosen]);
  const a = (await (await call(owner, "POST", `/api/notebooks/${hidden}/run`, {})).json()) as { runId: string };
  const b = (await (await call(owner, "POST", `/api/notebooks/${missing}/run`, {})).json()) as { runId: string };
  const messageA = String(await gotFrom(hidden, a.runId)).replace("zz-fx17-callee-picked", "X");
  const messageB = String(await gotFrom(missing, b.runId)).replace("zz-fx17-callee-picked-x", "X");
  assert.equal(messageA, messageB);
});

await check("D-12: a notebook with no owner calls nothing", async () => {
  const callee = (await pool.query("SELECT id FROM notebooks WHERE name = 'zz-fx17-callee-open'")).rows[0].id as string;
  const orphan = await caller("caller-orphan", owner, "zz-fx17-callee-open");
  await pool.query("UPDATE notebooks SET owner_id = NULL WHERE id = $1", [orphan]);
  if (activeSandboxConfig()) {
    // Where cells change uid there is no user to run an owner-less notebook as, so it does not
    // run at all: it cannot call anything, which is stronger than "calls nothing it may not".
    await assert.rejects(() => notebookExecutionService.start(orphan, () => {}, {}), NotebookWithoutOwnerError);
    return;
  }
  const run = await notebookExecutionService.start(orphan, () => {}, {});
  await run.completed;
  const { rows } = await pool.query("SELECT cell_results FROM notebook_runs WHERE id = $1", [run.runId]);
  const cell = Object.values(rows[0].cell_results as Record<string, { output?: { got?: unknown } }>)[0];
  assert.match(String(cell?.output?.got), /^ERR:.*not found/i);
  assert.ok(callee);
});

await check("D-12: a page button that runs another notebook reaches only what the page's owner may use", async () => {
  const target = (await pool.query("SELECT id FROM notebooks WHERE name = 'zz-fx17-callee-picked'")).rows[0].id as string;
  await setVisibility(target, "selected", [chosen]);
  const page = await caller("pager", owner, "zz-fx17-callee-open", {
    actions: [{ label: "Go", do: "run", notebook: "zz-fx17-callee-picked" }],
  });
  await notebooksService.deploy(page, "test");

  const press = await call(viewer, "POST", `/api/notebooks/${page}/actions/0`, {});
  assert.equal(press.status, 404, "the button ran a notebook its page's owner could not use");

  const pages = (await (await call(viewer, "GET", "/api/notebooks/pages")).json()) as { id: string; actions: { notebook?: string }[] }[];
  assert.ok(pages.find((entry) => entry.id === page), "the page itself is listed");

  await setVisibility(target, "selected", [owner]);
  const again = await call(viewer, "POST", `/api/notebooks/${page}/actions/0`, {});
  assert.equal(again.status, 200);
});

await check("a stranger cannot press a button on a page they cannot use", async () => {
  const hiddenPage = await seed("hidden-page", { owner, deployed: true, visibility: "selected", extra: { actions: [{ label: "Go", do: "rerun" }] } });
  assert.equal((await call(other, "POST", `/api/notebooks/${hiddenPage}/actions/0`, {})).status, 404);
});

// ── agent tokens and MCP (T-06) ───────────────────────────────────────────────

console.log("\nagents act as the person who made their token");

const mcpEndpoint = new URL(`${base}/mcp`);
const mcpClients: Client[] = [];

async function tokenFor(who: Person, scope: "author" | "reader" = "author"): Promise<string> {
  return (await agentTokensService.issue(who.id, `zz-fx17-${who.username}-${scope}`, scope)).token;
}

async function mcpAs(token: string): Promise<Client> {
  const client = new Client({ name: "zz-fx17-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(mcpEndpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  mcpClients.push(client);
  return client;
}

async function tool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: result.content.map((part) => part.text).join("\n"), isError: result.isError === true };
}

const ownerAgent = await mcpAs(await tokenFor(owner));
const editorAgent = await mcpAs(await tokenFor(editor));
const otherAgent = await mcpAs(await tokenFor(other));
const viewerAgent = await mcpAs(await tokenFor(viewer));
const chosenAgent = await mcpAs(await tokenFor(chosen));

await check("notebook_list and system_map show exactly what the person sees in the editor", async () => {
  const owners = (await tool(ownerAgent, "notebook_list")).text;
  assert.ok(owners.includes("zz-fx17-picked") && owners.includes("zz-fx17-draft"));
  assert.ok((await tool(editorAgent, "notebook_list")).text.includes("zz-fx17-picked"));

  for (const agent of [otherAgent, viewerAgent, chosenAgent]) {
    const text = (await tool(agent, "notebook_list")).text;
    assert.ok(!text.includes("zz-fx17-picked") && !text.includes("zz-fx17-draft") && !text.includes("zz-fx17-open"), text);
    const map = (await tool(agent, "system_map")).text;
    assert.ok(!map.includes("zz-fx17-picked") && !map.includes("zz-fx17-open"), map);
  }
  assert.ok((await tool(ownerAgent, "system_map")).text.includes("zz-fx17-picked"));
});

await check("a notebook an agent may not open is 'no notebook matches' — to read, run, edit or delete — the same as one that is not there", async () => {
  const missing = (await tool(otherAgent, "notebook_read", { notebook: "zz-fx17-no-such-notebook" })).text.replace("zz-fx17-no-such-notebook", "X");
  for (const [name, args] of [
    ["notebook_read", { notebook: "zz-fx17-picked" }],
    ["notebook_diff", { notebook: "zz-fx17-picked" }],
    ["run_list", { notebook: "zz-fx17-picked" }],
    ["notebook_run", { notebook: "zz-fx17-picked" }],
    ["notebook_run_cell", { notebook: "zz-fx17-picked", cell: "1" }],
    ["notebook_edit_setup", { notebook: "zz-fx17-picked", key: "secrets", value: "[]" }],
    ["notebook_delete", { notebook: "zz-fx17-picked", confirmName: "zz-fx17-picked" }],
  ] as const) {
    const result = await tool(otherAgent, name, args);
    assert.equal(result.isError, true, name);
    assert.equal(result.text.replace("zz-fx17-picked", "X"), missing, name);
  }
  assert.ok((await pool.query("SELECT 1 FROM notebooks WHERE id = $1", [picked])).rowCount === 1, "it was deleted");
});

await check("writing text that names somebody else's id overwrites nothing", async () => {
  const text = ["---", `id: ${picked}`, "name: zz-fx17-hijack", "runtime: node", "---", "", "```js", "return {};", "```"].join("\n");
  const result = await tool(otherAgent, "notebook_write", { text });
  assert.equal(result.isError, true);
  assert.equal((await pool.query("SELECT name FROM notebooks WHERE id = $1", [picked])).rows[0].name, "zz-fx17-picked");
});

await check("an agent's notebook belongs to the person behind its token, and its runs are recorded as theirs", async () => {
  const text = ["---", "name: zz-fx17-agent-made", "runtime: node", "outputs: [answer]", "---", "", "```js", "return { answer: 1 };", "```"].join("\n");
  const written = await tool(otherAgent, "notebook_write", { text });
  assert.equal(written.isError, false, written.text);
  const id = /`([0-9a-f-]{36})`/.exec(written.text)?.[1] as string;
  assert.equal(await access.ownerOf(id), other.id);

  const ran = JSON.parse((await tool(otherAgent, "notebook_run", { notebook: "zz-fx17-agent-made" })).text) as { runId: string };
  const { rows } = await pool.query("SELECT started_by FROM notebook_runs WHERE id = $1", [ran.runId]);
  assert.equal(rows[0].started_by, other.id);
  assert.equal((await tool(ownerAgent, "notebook_read", { notebook: "zz-fx17-agent-made" })).isError, true, "the owner of another notebook read it");
});

await check("an editor's agent reads, runs and edits the owner's notebook, but cannot delete it", async () => {
  assert.equal((await tool(editorAgent, "notebook_read", { notebook: "zz-fx17-picked" })).isError, false);
  assert.equal((await tool(editorAgent, "notebook_run", { notebook: "zz-fx17-picked" })).isError, false);
  const refused = await tool(editorAgent, "notebook_delete", { notebook: "zz-fx17-picked", confirmName: "zz-fx17-picked" });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /owner/);
  assert.equal((await pool.query("SELECT 1 FROM notebooks WHERE id = $1", [picked])).rowCount, 1);
});

await check("run_inspect answers for a run the person could read in the browser, and for no other", async () => {
  const { rows } = await pool.query("SELECT id FROM notebook_runs WHERE notebook_id = $1 AND started_by = $2 LIMIT 1", [picked, owner.id]);
  const ownersRun = rows[0].id as string;
  assert.equal((await tool(ownerAgent, "run_inspect", { run: ownersRun })).isError, false);
  assert.equal((await tool(editorAgent, "run_inspect", { run: ownersRun })).isError, false);
  assert.equal((await tool(otherAgent, "run_inspect", { run: ownersRun })).isError, true, "a stranger read a run by id");
  assert.equal((await tool(chosenAgent, "run_inspect", { run: ownersRun })).isError, true, "a page user read the team's run");
});

await check("deployed notebooks are offered as tools only to the people who may use that app", async () => {
  const toolName = toolNameFor("zz-fx17-picked");
  const names = async (agent: Client) => (await agent.listTools()).tools.map((entry) => entry.name);
  assert.ok((await names(chosenAgent)).includes(toolName), "the named user was not offered it");
  assert.ok((await names(ownerAgent)).includes(toolName));
  assert.ok(!(await names(otherAgent)).includes(toolName), "a stranger was offered a selected app");
  assert.ok(!(await names(viewerAgent)).includes(toolName));
  assert.ok((await names(otherAgent)).includes(toolNameFor("zz-fx17-open")), "an app open to everybody is offered to everybody");
});

await check("secret_list_names lists the agent's own person's secrets", async () => {
  assert.match((await tool(editorAgent, "secret_list_names")).text, /ZZ_FX17_TOKEN/);
  assert.doesNotMatch((await tool(editorAgent, "secret_list_names")).text, /ZZ_FX17_ONLY_OTHER/);
  assert.match((await tool(otherAgent, "secret_list_names")).text, /ZZ_FX17_ONLY_OTHER/);
});

await check("an author token whose person is demoted to viewer loses write access, at once, even on an open session", async () => {
  const demoted = await person("demoted", "creator");
  const token = await tokenFor(demoted);
  const before = await mcpAs(token);
  assert.ok((await before.listTools()).tools.some((entry) => entry.name === "notebook_write"));

  await pool.query("UPDATE users SET role = 'viewer' WHERE id = $1", [demoted.id]);
  const after = await mcpAs(token);
  const names = (await after.listTools()).tools.map((entry) => entry.name);
  assert.ok(!names.includes("notebook_write"), "a demoted person's author token still writes");
  await assert.rejects(() => before.callTool({ name: "notebook_list", arguments: {} }), /401|different token scope|Reconnect/i);
});

await check("a token stops working with its person: deactivated is refused", async () => {
  const gone = await person("gone", "creator");
  const token = await tokenFor(gone);
  await authService.setActive(gone.id, false);
  await assert.rejects(() => mcpAs(token), /401|Unauthorized|deactivated/i);
});

await check("a person lists and revokes only their own tokens", async () => {
  const mine = (await (await call(owner, "POST", "/api/agent-tokens", { label: "zz-fx17-owner-api", scope: "reader" })).json()) as { record: { id: string } };
  const listed = async (who: Person) => ((await (await call(who, "GET", "/api/agent-tokens")).json()) as { id: string }[]).map((row) => row.id);
  assert.ok((await listed(owner)).includes(mine.record.id));
  assert.ok(!(await listed(editor)).includes(mine.record.id), "somebody else's token was listed");
  assert.equal((await call(editor, "DELETE", `/api/agent-tokens/${mine.record.id}`)).status, 404);
  assert.ok((await listed(owner)).includes(mine.record.id), "somebody else revoked it");
  assert.equal((await call(owner, "DELETE", `/api/agent-tokens/${mine.record.id}`)).status, 200);
});

for (const client of mcpClients) await client.close().catch(() => {});

// ── the WebSocket (T-07) ──────────────────────────────────────────────────────

console.log("\nwho hears which run");

const manager = new WebSocketManager(server, hub);
const wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;

interface Socket {
  messages: Record<string, unknown>[];
  send: (message: Record<string, unknown>) => void;
  close: () => void;
}

async function wsAs(token: string, ...then: Record<string, unknown>[]): Promise<Socket> {
  const socket = new WebSocket(wsUrl);
  const messages: Record<string, unknown>[] = [];
  await new Promise<void>((resolve) => socket.on("open", () => resolve()));
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  socket.send(JSON.stringify({ action: "auth", token }));
  for (const message of then) socket.send(JSON.stringify(message));
  return { messages, send: (message) => socket.send(JSON.stringify(message)), close: () => socket.close() };
}

const settle = () => sleep(250);
const activityFor = (socket: Socket, runId: string) =>
  socket.messages.filter((message) => message.type === "run:activity" && message.runId === runId);

/** Starts a run through the API and waits for it to end, so its whole buffer is there to replay. */
async function startRun(who: Person, id: string): Promise<string> {
  const res = await call(who, "POST", `/api/notebooks/${id}/run`, {});
  assert.equal(res.status, 200);
  return ((await res.json()) as { runId: string }).runId;
}

await check("watching with '*' tells a session only about runs it could read over REST", async () => {
  const watchers = {
    owner: await wsAs(owner.token, { action: "watch" }),
    editor: await wsAs(editor.token, { action: "watch" }),
    other: await wsAs(other.token, { action: "watch" }),
    viewer: await wsAs(viewer.token, { action: "watch" }),
    chosen: await wsAs(chosen.token, { action: "watch" }),
  };
  await settle();

  const ownersRun = await startRun(owner, picked);
  const chosensRun = await startRun(chosen, picked);
  const othersOwn = await seed("watch-others", { owner: other, deployed: true });
  const othersRun = await startRun(other, othersOwn);
  await finished(picked, ownersRun);
  await finished(picked, chosensRun);
  await finished(othersOwn, othersRun);
  await settle();

  for (const label of ["owner", "editor"] as const) {
    assert.ok(activityFor(watchers[label], ownersRun).length > 0, `${label} missed the owner's run`);
    assert.ok(activityFor(watchers[label], chosensRun).length > 0, `${label} missed the page user's run`);
    assert.equal(activityFor(watchers[label], othersRun).length, 0, `${label} heard about somebody else's notebook`);
  }
  assert.ok(activityFor(watchers.chosen, chosensRun).length > 0, "a page user missed their own run");
  assert.equal(activityFor(watchers.chosen, ownersRun).length, 0, "a page user heard the team's run");
  assert.ok(activityFor(watchers.other, othersRun).length > 0, "the owner of the other notebook missed their own run");
  for (const label of ["other", "viewer"] as const) {
    assert.equal(activityFor(watchers[label], ownersRun).length, 0, `${label} heard about a notebook they cannot see`);
    assert.equal(activityFor(watchers[label], chosensRun).length, 0, `${label} heard about a run on a notebook they cannot see`);
  }
  assert.equal(activityFor(watchers.viewer, othersRun).length, 0);
  for (const socket of Object.values(watchers)) socket.close();
});

await check("subscribing to a run by id needs the right to read that run", async () => {
  const ownersRun = await startRun(owner, everyone);
  const chosensRun = await startRun(chosen, everyone);
  await finished(everyone, ownersRun);
  await finished(everyone, chosensRun);

  const sockets = {
    owner: await wsAs(owner.token, { action: "subscribe", runId: ownersRun }, { action: "subscribe", runId: chosensRun }),
    chosen: await wsAs(chosen.token, { action: "subscribe", runId: ownersRun }, { action: "subscribe", runId: chosensRun }),
    other: await wsAs(other.token, { action: "subscribe", runId: ownersRun }, { action: "subscribe", runId: chosensRun }),
  };
  await settle();

  const events = (socket: Socket, runId: string) => socket.messages.filter((message) => message.runId === runId);
  assert.ok(events(sockets.owner, ownersRun).length > 0 && events(sockets.owner, chosensRun).length > 0, "the owner follows both");
  assert.equal(events(sockets.chosen, ownersRun).length, 0, "a page user followed the team's run by its id");
  assert.ok(events(sockets.chosen, chosensRun).length > 0, "a page user cannot follow their own run");
  assert.equal(events(sockets.other, ownersRun).length, 0, "a stranger followed a run by its id");
  assert.equal(events(sockets.other, chosensRun).length, 0);
  assert.ok(sockets.other.messages.some((message) => message.type === "run:denied"), "a refusal says so");
  for (const socket of Object.values(sockets)) socket.close();
});

await check("K-16 (L-04): a share link follows the runs it started, and no other run, not even of its own notebook", async () => {
  const share = (await (await call(owner, "POST", `/api/notebooks/${everyone}/shares`)).json()) as { token: string };
  const started = await fetch(`${base}/api/shared/${share.token}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(started.status, 200);
  const own = ((await started.json()) as { runId: string }).runId;
  const sameNotebook = await startRun(owner, everyone);
  const foreign = await startRun(owner, picked);
  await finished(everyone, own);
  await finished(everyone, sameNotebook);
  await finished(picked, foreign);

  const socket = await wsAs(
    share.token,
    { action: "subscribe", runId: own },
    { action: "subscribe", runId: sameNotebook },
    { action: "subscribe", runId: foreign }
  );
  await settle();
  assert.ok(socket.messages.some((message) => message.runId === own), "the link cannot follow the run it started");
  assert.ok(!socket.messages.some((message) => message.runId === sameNotebook), "a share link followed another run of its own notebook");
  assert.ok(!socket.messages.some((message) => message.runId === foreign), "a share link followed a run of another notebook");
  assert.ok(socket.messages.filter((message) => message.type === "run:denied").length >= 2);
  socket.close();
});

await check("a share link still cannot watch", async () => {
  const share = (await (await call(owner, "POST", `/api/notebooks/${everyone}/shares`)).json()) as { token: string };
  const socket = await wsAs(share.token, { action: "watch" });
  await settle();
  assert.ok(socket.messages.some((message) => message.type === "run:denied"));
  socket.close();
});

await check("catalog changes reach only the people who could see that notebook — and a save only the team", async () => {
  const watchers = {
    owner: await wsAs(owner.token, { action: "watch" }),
    other: await wsAs(other.token, { action: "watch" }),
    chosen: await wsAs(chosen.token, { action: "watch" }),
  };
  await settle();
  const notices = (socket: Socket, id: string) => socket.messages.filter((message) => message.type === "catalog:changed" && message.notebookId === id);

  await notebooksService.save({ ...(JSON.parse((await pool.query("SELECT document FROM notebooks WHERE id = $1", [picked])).rows[0].document) as NotebookJson), tags: ["zz-fx17-tag-2"] }, "test");
  await settle();
  assert.ok(notices(watchers.owner, picked).length > 0, "the owner missed a save");
  assert.equal(notices(watchers.chosen, picked).length, 0, "a page user was told the author saved");
  assert.equal(notices(watchers.other, picked).length, 0, "a stranger was told a notebook they cannot see was saved");

  await notebooksService.deploy(picked, "test");
  await settle();
  assert.ok(notices(watchers.chosen, picked).some((message) => message.change === "deployed"), "a page user missed the deploy");
  assert.equal(notices(watchers.other, picked).length, 0);

  const doomed = await seed("doomed", { owner, deployed: true, visibility: "selected", appUsers: [chosen] });
  await notebooksService.delete(doomed);
  await settle();
  assert.ok(notices(watchers.owner, doomed).some((message) => message.change === "deleted"));
  assert.ok(notices(watchers.chosen, doomed).some((message) => message.change === "deleted"), "the people who used it were not told it is gone");
  assert.equal(notices(watchers.other, doomed).length, 0, "a stranger was told about a delete");
  for (const message of watchers.owner.messages.filter((entry) => entry.type === "catalog:changed")) {
    assert.deepEqual(Object.keys(message).sort(), ["change", "notebookId", "type"], "the audience list leaked to the client");
  }
  for (const socket of Object.values(watchers)) socket.close();
});

// ── storage (T-08) ────────────────────────────────────────────────────────────

console.log("\nstorage: a notebook's folders are its team's");

const ownersFolders = [path.join(STORAGE_DIR, "notebooks", picked), path.join(STORAGE_DIR, "uploads", picked)];
const othersNotebook = "zz-fx17-nb-watch-others";
const othersFolder = path.join(STORAGE_DIR, "notebooks", othersNotebook);
const sharedFolder = path.join(STORAGE_DIR, "zz-fx17-shared");
for (const folder of [...ownersFolders, othersFolder, sharedFolder]) fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(ownersFolders[0], "zz-fx17-note.txt"), "the owner's output");
fs.writeFileSync(path.join(ownersFolders[1], "zz-fx17-upload.txt"), "somebody uploaded this");
fs.writeFileSync(path.join(othersFolder, "zz-fx17-theirs.txt"), "the other creator's output");
fs.writeFileSync(path.join(sharedFolder, "zz-fx17-common.txt"), "shared among creators");

const listing = async (who: Person, dir: string, search = "") => {
  const res = await call(who, "GET", `/api/resources/files?dir=${encodeURIComponent(dir)}${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  assert.equal(res.status, 200);
  return (await res.json()) as { name: string; path: string; url?: string }[];
};
const fetchStored = (who: Person | null, relative: string, query = "") =>
  fetch(`${base}/storage/${relative}${query}`, { headers: who ? who.headers : {} });

await check("the Resources list shows a notebook's folders only to the people who can edit that notebook", async () => {
  const names = async (who: Person, dir: string) => (await listing(who, dir)).map((item) => item.name);
  for (const who of [owner, editor]) {
    assert.ok((await names(who, "notebooks")).includes(picked), "the team cannot see its own folder");
    assert.ok((await names(who, "uploads")).includes(picked));
    assert.deepEqual(await names(who, `notebooks/${picked}`), ["zz-fx17-note.txt"]);
  }
  for (const who of [other, viewer, chosen]) {
    assert.ok(!(await names(who, "notebooks")).includes(picked), "somebody else's notebook folder is listed");
    assert.ok(!(await names(who, "uploads")).includes(picked));
    assert.deepEqual(await names(who, `notebooks/${picked}`), [], "looking inside it found something");
  }
  assert.ok((await names(other, "notebooks")).includes(othersNotebook), "a creator cannot see their own notebook's folder");
  assert.ok(!(await names(owner, "notebooks")).includes(othersNotebook));
});

await check("a search does not turn up files from somebody else's notebook folders", async () => {
  const paths = async (who: Person) => (await listing(who, "", "zz-fx17-")).map((item) => item.path);
  assert.ok((await paths(owner)).includes(`notebooks/${picked}/zz-fx17-note.txt`));
  const strangers = await paths(other);
  assert.ok(!strangers.some((entry) => entry.includes(picked)), `a search found ${strangers.join(", ")}`);
  assert.ok(strangers.includes(`notebooks/${othersNotebook}/zz-fx17-theirs.txt`));
});

await check("other folders stay shared among creators, as they always were", async () => {
  for (const who of [owner, other]) {
    assert.ok((await listing(who, "zz-fx17-shared")).some((item) => item.name === "zz-fx17-common.txt"));
  }
});

await check("the bearer path of /storage follows the same rule", async () => {
  assert.equal((await fetchStored(owner, `notebooks/${picked}/zz-fx17-note.txt`)).status, 200);
  assert.equal((await fetchStored(editor, `uploads/${picked}/zz-fx17-upload.txt`)).status, 200);
  for (const who of [other, viewer, chosen]) {
    assert.equal((await fetchStored(who, `notebooks/${picked}/zz-fx17-note.txt`)).status, 404, "a bearer token read somebody else's output");
    assert.equal((await fetchStored(who, `uploads/${picked}/zz-fx17-upload.txt`)).status, 404);
  }
  assert.equal((await fetchStored(other, "zz-fx17-shared/zz-fx17-common.txt")).status, 200);
  const hidden = await fetchStored(other, `notebooks/${picked}/zz-fx17-note.txt`);
  const missing = await fetchStored(other, `notebooks/${picked}/zz-fx17-nothing-here.txt`);
  assert.equal(await hidden.text(), await missing.text(), "a hidden file and a missing one answer differently");
});

await check("a signed link from the owner's listing still works for anyone holding it", async () => {
  const [item] = (await listing(owner, `notebooks/${picked}`)).filter((entry) => entry.name === "zz-fx17-note.txt");
  assert.ok(item.url, "the owner's listing carried no link");
  const res = await fetch(`${base}${item.url}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "the owner's output");
});

await check("nobody can rename, delete, upload into or create folders inside somebody else's notebook folder", async () => {
  const id = Buffer.from(`notebooks/${picked}/zz-fx17-note.txt`).toString("base64");
  assert.equal((await call(other, "PATCH", `/api/resources/files/${encodeURIComponent(id)}`, { name: "zz-fx17-renamed.txt" })).status, 404);
  assert.equal((await call(other, "DELETE", `/api/resources/files/${encodeURIComponent(id)}`)).status, 404);
  assert.equal((await call(other, "POST", "/api/resources/folders", { name: "zz-fx17-sub", dir: `notebooks/${picked}` })).status, 404);

  const form = new FormData();
  form.append("file", new Blob(["planted"], { type: "text/plain" }), "zz-fx17-planted.txt");
  const upload = await fetch(`${base}/api/resources/files?dir=${encodeURIComponent(`uploads/${picked}`)}`, { method: "POST", headers: other.headers, body: form });
  assert.equal(upload.status, 404);

  assert.ok(fs.existsSync(path.join(ownersFolders[0], "zz-fx17-note.txt")), "the file was renamed or deleted");
  assert.ok(!fs.existsSync(path.join(ownersFolders[1], "zz-fx17-planted.txt")), "a file was planted");
  assert.ok(!fs.existsSync(path.join(ownersFolders[0], "zz-fx17-sub")));
  assert.equal((await call(owner, "POST", "/api/resources/folders", { name: "zz-fx17-sub", dir: `notebooks/${picked}` })).status, 200);
});

for (const folder of [...ownersFolders, othersFolder, sharedFolder]) fs.rmSync(folder, { recursive: true, force: true });

// ── managing access, and the way back (T-09) ──────────────────────────────────

console.log("\nwho decides who has access");

const sharing = await seed("sharing", { owner, deployed: true, editors: [editor] });
const accessOf = async (who: Person, id = sharing) => (await call(who, "GET", `/api/notebooks/${id}/access`)).status;

await check("only the owner may read or change the access list: an editor is told it is not theirs, anyone else that there is no such notebook", async () => {
  assert.equal(await accessOf(owner), 200);
  assert.equal(await accessOf(editor), 403);
  for (const who of [other, viewer, chosen]) assert.equal(await accessOf(who), 404);
  assert.equal(await accessOf(other, "zz-fx17-no-such-notebook"), 404);
  const hidden = await call(other, "GET", `/api/notebooks/${picked}/access`);
  const missing = await call(other, "GET", `/api/notebooks/zz-fx17-no-such-notebook/access`);
  assert.equal(await hidden.text(), await missing.text());

  const before = await (await call(owner, "GET", `/api/notebooks/${sharing}/access`)).json();
  assert.equal((await call(editor, "PUT", `/api/notebooks/${sharing}/access`, { editors: [], appVisibility: "selected" })).status, 403);
  assert.equal((await call(other, "PUT", `/api/notebooks/${sharing}/access`, { editors: [other.username] })).status, 404);
  assert.deepEqual(await (await call(owner, "GET", `/api/notebooks/${sharing}/access`)).json(), before, "a refused change was applied");
});

await check("the owner sees owner, editors, visibility and app users", async () => {
  const body = await (await call(owner, "GET", `/api/notebooks/${sharing}/access`)).json();
  assert.deepEqual(body, {
    owner: { id: owner.id, username: owner.username },
    editors: [{ id: editor.id, username: editor.username }],
    appVisibility: "all",
    appUsers: [],
  });
});

await check("the owner adds and removes editors, and the change is felt at once", async () => {
  assert.equal((await call(other, "GET", `/api/notebooks/${sharing}`)).status, 404);
  const added = await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { editors: [editor.username, other.username] });
  assert.equal(added.status, 200);
  assert.deepEqual(((await added.json()) as { editors: { username: string }[] }).editors.map((entry) => entry.username).sort(), [editor.username, other.username].sort());
  assert.equal((await call(other, "GET", `/api/notebooks/${sharing}`)).status, 200);

  await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { editors: [editor.username] });
  assert.equal((await call(other, "GET", `/api/notebooks/${sharing}`)).status, 404);
});

await check("the owner chooses who may use the app, and the Apps list follows", async () => {
  const pagesOf = async (who: Person) => ((await (await call(who, "GET", "/api/notebooks/pages")).json()) as { id: string }[]).map((page) => page.id);
  assert.ok((await pagesOf(viewer)).includes(sharing), "open to everybody to begin with");

  const res = await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { appVisibility: "selected", appUsers: [chosen.username] });
  assert.equal(res.status, 200);
  assert.ok(!(await pagesOf(viewer)).includes(sharing), "still listed for somebody not named");
  assert.ok(!(await pagesOf(other)).includes(sharing));
  assert.ok((await pagesOf(chosen)).includes(sharing));
  assert.ok((await pagesOf(editor)).includes(sharing), "an editor reaches the app without being named");
  assert.equal((await call(viewer, "POST", `/api/notebooks/${sharing}/run`, {})).status, 404);

  // Keeps what it was not told about.
  const kept = await (await call(owner, "GET", `/api/notebooks/${sharing}/access`)).json();
  assert.equal(kept.editors.length, 1);
  await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { appVisibility: "all" });
  assert.ok((await pagesOf(viewer)).includes(sharing));
});

await check("an unknown username, a viewer as editor or a bad visibility is a 400 that says which, and nothing is applied", async () => {
  const before = await (await call(owner, "GET", `/api/notebooks/${sharing}/access`)).json();

  const ghost = await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { editors: [other.username, "zz-fx17-ghost"] });
  assert.equal(ghost.status, 400);
  assert.match(((await ghost.json()) as { error: string }).error, /zz-fx17-ghost/);

  const viewerAsEditor = await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { editors: [viewer.username] });
  assert.equal(viewerAsEditor.status, 400);
  assert.match(((await viewerAsEditor.json()) as { error: string }).error, /creator/);

  assert.equal((await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { appVisibility: "friends" })).status, 400);
  assert.equal((await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { appUsers: ["zz-fx17-ghost"] })).status, 400);

  assert.deepEqual(await (await call(owner, "GET", `/api/notebooks/${sharing}/access`)).json(), before, "a refused change was partly applied");
});

await check("naming the owner as an editor adds nothing", async () => {
  await call(owner, "PUT", `/api/notebooks/${sharing}/access`, { editors: [owner.username, editor.username] });
  const body = await (await call(owner, "GET", `/api/notebooks/${sharing}/access`)).json();
  assert.deepEqual(body.editors.map((entry: { username: string }) => entry.username), [editor.username]);
});

console.log("\ntransfer-owner");

const here = path.dirname(fileURLToPath(import.meta.url));
function transfer(...args: string[]): { code: number; out: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(here, "../scripts/transfer-owner.ts"), ...args], {
    cwd: path.resolve(here, ".."),
    encoding: "utf8",
  });
  return { code: result.status ?? 1, out: `${result.stdout}${result.stderr}` };
}

await check("the CLI moves one notebook, and copies the secrets it names to the new owner", async () => {
  const id = await reporter("transferred", other, "ZZ_FX17_ONLY_OTHER");
  const second = await reporter("stays", other, "ZZ_FX17_ONLY_OTHER");
  const result = transfer(other.username, editor.username, "--notebook", id);
  assert.equal(result.code, 0, result.out);
  assert.equal(await access.ownerOf(id), editor.id);
  assert.equal(await access.ownerOf(second), other.id, "a notebook that was not named moved");
  assert.match(result.out, /ZZ_FX17_ONLY_OTHER/);

  const run = (await (await call(editor, "POST", `/api/notebooks/${id}/run`, {})).json()) as { runId: string };
  assert.equal(await gotFrom(id, run.runId), rev("other-value"), "the new owner's run did not have the secret the notebook names");
  assert.equal(await storedSecret("owner_id = $1 AND key = 'ZZ_FX17_ONLY_OTHER'", [other.id]), "other-value", "the old owner lost theirs");
});

await check("the CLI keeps a secret the new owner already has", async () => {
  const id = await reporter("transfer-conflict", other, "ZZ_FX17_TOKEN");
  await putSecret(other, "ZZ_FX17_TOKEN", "other-token");
  assert.equal(transfer(other.username, editor.username, "--notebook", id).code, 0);
  assert.equal(await storedSecret("owner_id = $1 AND key = 'ZZ_FX17_TOKEN'", [editor.id]), "editor-value", "the new owner's own secret was overwritten");
});

await check("the CLI moves everything an account owns, or the notebooks nobody owns", async () => {
  const orphan = await seed("orphan", { owner: null, deployed: true });
  const result = transfer("--orphaned", owner.username);
  assert.equal(result.code, 0, result.out);
  assert.equal(await access.ownerOf(orphan), owner.id);
  assert.equal(await access.ownerOf(ownerless), owner.id);

  const all = transfer(other.username, editor.username);
  assert.equal(all.code, 0, all.out);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM notebooks WHERE owner_id = $1", [other.id])).rows[0].n, 0);
});

await check("the CLI refuses an account that cannot own, and one that does not exist", async () => {
  assert.notEqual(transfer(owner.username, viewer.username).code, 0);
  assert.match(transfer(owner.username, viewer.username).out, /creator/);
  assert.notEqual(transfer(owner.username, "zz-fx17-ghost").code, 0);
  assert.notEqual(transfer("zz-fx17-ghost", owner.username).code, 0);
  assert.equal(await access.ownerOf(sharing), owner.id);
});

// ── next ──
manager.close();
server.close();

await clean();

// ── finish ──
console.log(`\n${passed} passed, ${failed} failed`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);

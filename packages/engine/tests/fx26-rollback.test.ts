/**
 * FX-26 — rollback is a new deploy of an immutable historical version.
 *
 * Covers version numbering, trigger rebuilding, audit provenance, deployer secrets,
 * authorization, deploy guards, and reuse of locked Python packages. All fixtures use
 * `zz-fx26-rb-` and are removed before and after the suite.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/fx26-rollback.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { NotebookJson, NotebookVersionSummary } from "@zaa-tool/shared";
import { createApp } from "../src/server/app.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { secretsService } from "../src/services/secrets.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";

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

const PREFIX = "zz-fx26-rb-";
const USERS = [`${PREFIX}owner`, `${PREFIX}editor`, `${PREFIX}viewer`, `${PREFIX}outsider`];
const PASSWORD = "zz-fx26-rb-password-long";

async function cleanup(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM notebooks WHERE name LIKE $1", [`${PREFIX}%`]);
  for (const row of rows) await notebooksService.delete(row.id).catch(() => {});
  await pool.query("DELETE FROM secrets WHERE key = 'ZZ_FX26_RB_KEY'").catch(() => {});
  await pool.query("DELETE FROM users WHERE username = ANY($1)", [USERS]).catch(() => {});
}

await initDb();
await cleanup();
const OWNER = await authService.createUser(USERS[0], PASSWORD, "creator");
const EDITOR = await authService.createUser(USERS[1], PASSWORD, "creator");
const VIEWER = await authService.createUser(USERS[2], PASSWORD, "viewer");
const OUTSIDER = await authService.createUser(USERS[3], PASSWORD, "creator");
const tokens = {
  owner: (await authService.login(USERS[0], PASSWORD)).token,
  editor: (await authService.login(USERS[1], PASSWORD)).token,
  viewer: (await authService.login(USERS[2], PASSWORD)).token,
  outsider: (await authService.login(USERS[3], PASSWORD)).token,
};

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

function api(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function bodyAs<T>(res: Response, status: number): Promise<T> {
  const text = await res.text();
  assert.equal(res.status, status, text);
  return JSON.parse(text) as T;
}

const created: string[] = [];
async function store(doc: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save(
    { version: "1.0", ...doc },
    "test",
    OWNER.id,
    { expectedRevision: "any" }
  );
  if (!created.includes(id)) created.push(id);
  return id;
}

function mainDocument(marker: string, slug: string): Omit<NotebookJson, "version"> {
  return {
    id: "",
    name: `${PREFIX}main`,
    runtime: "node",
    outputs: ["marker"],
    triggers: [{ id: `${slug}-trigger`, kind: "webhook", slug }],
    steps: [{ id: `${PREFIX}main-cell`, kind: "cell", code: `return { marker: '${marker}' };` }],
  };
}

async function deploy(id: string, token = tokens.owner): Promise<{ versionId: string }> {
  return bodyAs<{ versionId: string }>(
    await api(`/api/notebooks/${id}/deploy`, token, { method: "POST", body: "{}" }),
    200
  );
}

async function versions(id: string, token = tokens.owner): Promise<NotebookVersionSummary[]> {
  return bodyAs<NotebookVersionSummary[]>(await api(`/api/notebooks/${id}/versions`, token), 200);
}

async function rollback(id: string, versionId: string, token = tokens.owner): Promise<Response> {
  return api(`/api/notebooks/${id}/versions/${versionId}/deploy`, token, { method: "POST", body: "{}" });
}

async function versionCount(id: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM notebook_versions WHERE notebook_id = $1",
    [id]
  );
  return rows[0].count;
}

let mainId = "";
let firstVersion: NotebookVersionSummary | null = null;
let fourthVersion: NotebookVersionSummary | null = null;

console.log("\nFX-26: version history and rollback");

await check("three deploys form v1 through v3 and only v3 is current", async () => {
  const slugs = [`${PREFIX}hook-one-abcdefghijklmnopqrstuvwxyz`, `${PREFIX}hook-two-abcdefghijklmnopqrstuvwxyz`, `${PREFIX}hook-three-abcdefghijklmnopqrstuvwxyz`];
  mainId = await store(mainDocument("one", slugs[0]));
  await deploy(mainId);
  await store({ ...mainDocument("two", slugs[1]), id: mainId });
  await deploy(mainId);
  await store({ ...mainDocument("three", slugs[2]), id: mainId });
  await deploy(mainId);

  const listed = await versions(mainId);
  assert.equal(listed.length, 3);
  assert.deepEqual(listed.map((v) => v.number), [3, 2, 1]);
  assert.deepEqual(listed.map((v) => v.isCurrent), [true, false, false]);
  assert.ok(listed.every((v) => v.sourceVersionId === null && v.sourceNumber === null));
  assert.equal(listed[2].triggers[0]?.label, `/hooks/${slugs[0]}`);
  firstVersion = listed[2];
  const document = await bodyAs<NotebookJson>(
    await api(`/api/notebooks/${mainId}/versions/${firstVersion.id}`, tokens.owner),
    200
  );
  assert.equal(document.outputs?.[0], "marker");
  assert.match(document.steps[0].kind === "cell" ? document.steps[0].code : "", /'one'/);
});

await check("rollback pins a new v4 with the source document, triggers, audit and unchanged draft", async () => {
  assert.ok(firstVersion);
  const before = await notebooksService.getById(mainId);
  assert.ok(before);
  const draftBefore = JSON.stringify(notebooksService.parseDocument(before));
  const sourceDocument = await notebooksService.getVersion(mainId, firstVersion.id);
  assert.ok(sourceDocument);

  const result = await bodyAs<{ versionId: string }>(await rollback(mainId, firstVersion.id), 200);
  assert.notEqual(result.versionId, firstVersion.id);
  const listed = await versions(mainId);
  assert.equal(listed.length, 4);
  fourthVersion = listed[0];
  assert.equal(fourthVersion.number, 4);
  assert.equal(fourthVersion.id, result.versionId);
  assert.equal(fourthVersion.isCurrent, true);
  assert.equal(fourthVersion.sourceVersionId, firstVersion.id);
  assert.equal(fourthVersion.sourceNumber, 1);
  assert.deepEqual(await notebooksService.getVersion(mainId, result.versionId), sourceDocument);

  const { rows: indexed } = await pool.query<{ slug: string }>(
    "SELECT slug FROM notebook_triggers WHERE notebook_id = $1",
    [mainId]
  );
  assert.deepEqual(indexed.map((row) => row.slug), sourceDocument.triggers?.map((trigger) => trigger.slug));
  const oldHook = await fetch(`${base}/hooks/${sourceDocument.triggers?.[0]?.slug}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(oldHook.status, 200, await oldHook.clone().text());
  assert.deepEqual((await oldHook.json()).outputs, { marker: "one" });
  const removedSlug = (await notebooksService.getVersion(mainId, listed[1].id))?.triggers?.[0]?.slug;
  const removedHook = await fetch(`${base}/hooks/${removedSlug}`, { method: "POST", body: "{}" });
  assert.equal(removedHook.status, 404);

  const { rows: audited } = await pool.query<{ meta: Record<string, unknown> }>(
    "SELECT meta FROM audit_events WHERE action = 'notebook.deploy' AND target_id = $1 ORDER BY id DESC LIMIT 1",
    [mainId]
  );
  assert.equal(audited[0]?.meta.rollbackOf, firstVersion.id);
  assert.equal(audited[0]?.meta.versionId, result.versionId);

  const after = await notebooksService.getById(mainId);
  assert.ok(after);
  assert.equal(JSON.stringify(notebooksService.parseDocument(after)), draftBefore);
  const state = await notebooksService.getDeployState(mainId);
  assert.equal(state?.versionId, result.versionId);
  assert.equal(state?.hasUndeployedChanges, true);
});

await check("an editor's rollback uses the editor's identity and production secrets", async () => {
  await secretsService.create(OWNER.id, "ZZ_FX26_RB_KEY", "owner-secret-value", true);
  await secretsService.create(EDITOR.id, "ZZ_FX26_RB_KEY", "editor-secret-value", true);
  const id = await store({
    id: "",
    name: `${PREFIX}secrets`,
    runtime: "node",
    secrets: ["ZZ_FX26_RB_KEY"],
    outputs: ["who"],
    steps: [
      {
        id: `${PREFIX}secrets-cell`,
        kind: "cell",
        code: "return { who: String(process.env.ZZ_FX26_RB_KEY ?? 'missing').split('-')[0] };",
      },
    ],
  });
  await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1, $2, 'editor')", [id, EDITOR.id]);
  const first = await deploy(id);
  await deploy(id);
  const result = await bodyAs<{ versionId: string }>(await rollback(id, first.versionId, tokens.editor), 200);
  const { rows } = await pool.query<{ deployed_by: string; deployed_by_user_id: string }>(
    "SELECT deployed_by, deployed_by_user_id FROM notebook_versions WHERE id = $1",
    [result.versionId]
  );
  assert.equal(rows[0].deployed_by, EDITOR.username);
  assert.equal(rows[0].deployed_by_user_id, EDITOR.id);

  const started = await notebookExecutionService.start(id, () => {}, {
    triggerSource: "webhook",
    startedBy: OWNER.id,
  });
  const execution = await started.completed;
  assert.equal(execution.status, "success", execution.errors.join("\n"));
  assert.deepEqual(execution.outputs, { who: "editor" });
});

await check("rolling back the active version is a typed 409 and writes no version", async () => {
  assert.ok(fourthVersion);
  const before = await versionCount(mainId);
  const res = await rollback(mainId, fourthVersion.id);
  const body = await bodyAs<{ error: string }>(res, 409);
  assert.match(body.error, /already in production/);
  assert.equal(await versionCount(mainId), before);
});

await check("foreign versions and non-editors cannot read or roll back the history", async () => {
  const otherId = await store({
    id: "",
    name: `${PREFIX}other`,
    runtime: "node",
    steps: [{ id: `${PREFIX}other-cell`, kind: "cell", code: "return {};" }],
  });
  const otherDeploy = await deploy(otherId);
  const before = await versionCount(mainId);
  await bodyAs<{ error: string }>(await rollback(mainId, otherDeploy.versionId), 404);
  await bodyAs<{ error: string }>(await api(`/api/notebooks/${mainId}/versions/${otherDeploy.versionId}`, tokens.owner), 404);
  await bodyAs<{ error: string }>(await api(`/api/notebooks/${mainId}/versions`, tokens.outsider), 404);
  const ordinary = await api(`/api/notebooks/${mainId}/deploy`, tokens.viewer, { method: "POST", body: "{}" });
  const ordinaryStatus = ordinary.status;
  await ordinary.text();
  const historical = await rollback(mainId, firstVersion?.id ?? "missing", tokens.viewer);
  assert.equal(historical.status, ordinaryStatus);
  await historical.text();
  assert.equal(await versionCount(mainId), before);
});

await check("a historical name held by another deployed notebook refuses rollback without moving production", async () => {
  const oldName = `${PREFIX}old-name`;
  const id = await store({
    id: "",
    name: oldName,
    runtime: "node",
    steps: [{ id: `${PREFIX}name-cell`, kind: "cell", code: "return {};" }],
  });
  const first = await deploy(id);
  const renamed = await notebooksService.getById(id);
  assert.ok(renamed);
  await store({ ...notebooksService.parseDocument(renamed), id, name: `${PREFIX}new-name` });
  const second = await deploy(id);
  const claimant = await store({
    id: "",
    name: oldName,
    runtime: "node",
    steps: [{ id: `${PREFIX}claimant-cell`, kind: "cell", code: "return {};" }],
  });
  await deploy(claimant);

  const res = await rollback(id, first.versionId);
  const body = await bodyAs<{ error: string }>(res, 409);
  assert.match(body.error, /already uses that name/);
  assert.equal(await versionCount(id), 2);
  const state = await notebooksService.getDeployState(id);
  assert.equal(state?.versionId, second.versionId);
});

await check("rollback copies locked Python packages and never resolves the current draft", async () => {
  const id = await store({
    id: "",
    name: `${PREFIX}python`,
    runtime: "python",
    packages: ["cowsay"],
    steps: [{ id: `${PREFIX}python-cell`, kind: "cell", code: "print('one')" }],
  });
  const first = await deploy(id);
  const { rows: sourceRows } = await pool.query<{ locked_packages: string[] }>(
    "SELECT locked_packages FROM notebook_versions WHERE id = $1",
    [first.versionId]
  );
  const locked = sourceRows[0].locked_packages;
  assert.ok(Array.isArray(locked) && locked.length > 0);
  assert.match(locked[0], /^cowsay==\d/);
  await store({
    id,
    name: `${PREFIX}python`,
    runtime: "python",
    packages: ["cowsay"],
    steps: [{ id: `${PREFIX}python-cell`, kind: "cell", code: "print('two')" }],
  });
  await deploy(id);
  await store({
    id,
    name: `${PREFIX}python`,
    runtime: "python",
    // Invalid on purpose: trying to resolve the draft during rollback would reject the spawn.
    packages: [null] as unknown as string[],
    steps: [{ id: `${PREFIX}python-cell`, kind: "cell", code: "print('draft')" }],
  });

  const result = await bodyAs<{ versionId: string }>(await rollback(id, first.versionId), 200);
  const { rows } = await pool.query<{ locked_packages: string[]; source_version_id: string }>(
    "SELECT locked_packages, source_version_id FROM notebook_versions WHERE id = $1",
    [result.versionId]
  );
  assert.deepEqual(rows[0].locked_packages, locked);
  assert.equal(rows[0].source_version_id, first.versionId);
});

await cleanup();
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

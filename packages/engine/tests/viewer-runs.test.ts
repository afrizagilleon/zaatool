/**
 * A viewer asks a page to work; a viewer does not get to run the draft.
 *
 * `POST /:id/run` used to be open to viewers and ran the DRAFT unless the body said
 * `mode: "deployed"` — including notebooks nobody had deployed, with `input` seeded
 * verbatim and any `cellId`. Also `GET /:id/runs/:runId` returned any run whatever `:id` was.
 *
 * Rows it creates are prefixed `zz-k11-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine test viewer-runs
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { authService } from "../src/services/auth.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson } from "@zaa-tool/shared";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => Promise<void>): Promise<void> {
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

await initDb();

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const CREATOR = "zz-k11-creator";
const VIEWER = "zz-k11-viewer";
const PASSWORD = "zz-k11-password";
let creatorId = "";
for (const [username, role] of [[CREATOR, "creator"], [VIEWER, "viewer"]] as const) {
  await pool.query("DELETE FROM users WHERE username = $1", [username]);
  const created = await authService.createUser(username, PASSWORD, role);
  if (username === CREATOR) creatorId = created.id;
}
const asCreator = { Authorization: `Bearer ${(await authService.login(CREATOR, PASSWORD)).token}` };
const asViewer = { Authorization: `Bearer ${(await authService.login(VIEWER, PASSWORD)).token}` };

async function as(headers: Record<string, string>, method: string, url: string, body?: unknown) {
  return fetch(`${base}${url}`, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const created: string[] = [];

async function store(name: string, marker: string, id = ""): Promise<string> {
  const doc: NotebookJson = {
    version: "1.0",
    id,
    name,
    runtime: "node",
    outputs: ["marker"],
    steps: [{ id: "k11-cell", kind: "cell", code: `return { marker: '${marker}' };` }],
  };
  const saved = await notebooksService.save(doc, "test", creatorId, { expectedRevision: "any" });
  if (!created.includes(saved.id)) created.push(saved.id);
  return saved.id;
}

async function runsOf(id: string) {
  return notebookRunsService.listByNotebook(id, 100);
}

/** The finished run a request started, read back through the API. */
async function finished(id: string, runId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const res = await as(asCreator, "GET", `/api/notebooks/${id}/runs/${runId}`);
    if (res.status === 200) {
      const run = await res.json();
      if (run.status !== "running") return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("run did not finish");
}

console.log("\nwhat a viewer's run may reach");

const neverDeployed = await store("zz-k11-undeployed", "draft-secret");

await check("a viewer cannot run a notebook nobody deployed, and nothing executes", async () => {
  const before = (await runsOf(neverDeployed)).length;
  // 404 since FX-17 (was 409): a notebook nobody deployed is not one a viewer may use, so
  // it is answered like one that does not exist rather than "exists but not deployed".
  const res = await as(asViewer, "POST", `/api/notebooks/${neverDeployed}/run`, {});
  assert.equal(res.status, 404);
  const res2 = await as(asViewer, "POST", `/api/notebooks/${neverDeployed}/run`, { mode: "draft" });
  assert.equal(res2.status, 404);
  assert.equal((await runsOf(neverDeployed)).length, before);
});

const served = await store("zz-k11-served", "deployed-version");
await notebooksService.deploy(served, "test");
await store("zz-k11-served", "draft-version", served);

await check("a viewer's plain run executes the deployed version, not the draft", async () => {
  for (const body of [{ args: {} }, { mode: "deployed", args: {} }, {}]) {
    const res = await as(asViewer, "POST", `/api/notebooks/${served}/run`, body);
    assert.equal(res.status, 200, JSON.stringify(body));
    const run = await finished(served, (await res.json()).runId);
    const source: string = run.cell_results["k11-cell"]?.source ?? "";
    assert.match(source, /deployed-version/);
    assert.ok(!source.includes("draft-version"), "the viewer ran the draft");
    assert.equal(run.trigger_source, "page");
  }
});

await check("a viewer who sends input or cellId is refused", async () => {
  const before = (await runsOf(served)).length;
  for (const body of [{ input: { x: 1 } }, { cellId: "k11-cell" }, { mode: "deployed", input: {} }]) {
    const res = await as(asViewer, "POST", `/api/notebooks/${served}/run`, body);
    assert.equal(res.status, 403, JSON.stringify(body));
    assert.match((await res.json()).error, /creator/);
  }
  assert.equal((await runsOf(served)).length, before);
});

await check("a creator still runs the draft, with input and cellId", async () => {
  const res = await as(asCreator, "POST", `/api/notebooks/${served}/run`, {});
  assert.equal(res.status, 200);
  const run = await finished(served, (await res.json()).runId);
  assert.match(run.cell_results["k11-cell"]?.source ?? "", /draft-version/);

  const withCell = await as(asCreator, "POST", `/api/notebooks/${served}/run`, {
    cellId: "k11-cell",
    input: { x: 1 },
  });
  assert.equal(withCell.status, 200);
  const cellRun = await finished(served, (await withCell.json()).runId);
  assert.equal(cellRun.trigger_source, "cell");

  // And an undeployed notebook is a creator's to run.
  const draftOnly = await as(asCreator, "POST", `/api/notebooks/${neverDeployed}/run`, {});
  assert.equal(draftOnly.status, 200);
  await finished(neverDeployed, (await draftOnly.json()).runId);
});

console.log("\na run belongs to its notebook");

await check("a run is not readable through another notebook's URL", async () => {
  const [run] = await runsOf(served);
  assert.ok(run, "no run to look up");
  assert.equal((await as(asCreator, "GET", `/api/notebooks/${served}/runs/${run.id}`)).status, 200);
  for (const headers of [asCreator, asViewer]) {
    const res = await as(headers, "GET", `/api/notebooks/${neverDeployed}/runs/${run.id}`);
    assert.equal(res.status, 404);
  }
});

await pool.query("DELETE FROM notebook_runs WHERE notebook_id = ANY($1)", [created]);
for (const id of created) await notebooksService.delete(id).catch(() => {});
await pool.query("DELETE FROM notebook_versions WHERE notebook_id = ANY($1)", [created]).catch(() => {});
await pool.query("DELETE FROM users WHERE username = ANY($1)", [[CREATOR, VIEWER]]);
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * FX15 / T-03 — production finds its callees by the names they were deployed under.
 *
 * `notebooks.run("name")` in a production run, a page button's target and the form that
 * button asks for used to be resolved against the draft `name` column. Each test here
 * changes a *draft* — renames it, or names another draft after it — and asks whether
 * production noticed. It must not, until the callee is deployed again. Draft runs keep
 * resolving drafts, which is the last group.
 *
 * Notebooks it creates are prefixed `zz-fx15-nm-` and removed at the start and the end;
 * so is the user `zz-fx15-nm-user`.
 *
 *   pnpm --filter @zaa-tool/engine test fx15-names
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { authService } from "../src/services/auth.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson, NotebookPage } from "@zaa-tool/shared";

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

const PREFIX = "zz-fx15-nm-";
const USER = "zz-fx15-nm-user";

async function cleanup(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE $1", [`${PREFIX}%`]);
  for (const row of rows) await notebooksService.delete(row.id).catch(() => {});
  await pool.query("DELETE FROM users WHERE username = $1", [USER]).catch(() => {});
}

await initDb();
await cleanup();
const OWNER = (await authService.createUser(USER, "zz-fx15-nm-password", "creator")).id;
const token = (await authService.login(USER, "zz-fx15-nm-password")).token;
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document }, "test", OWNER, { expectedRevision: "any" });
  return id;
}

/** A notebook whose one cell returns `{ from: <marker> }`. */
const callee = (name: string, marker: string, id = ""): Omit<NotebookJson, "version"> => ({
  id,
  name: PREFIX + name,
  runtime: "node",
  outputs: ["from"],
  steps: [{ id: `${name}-cell`, kind: "cell", code: `return { from: '${marker}' };` }],
});

/** A notebook that calls `target` by name and hands back what it answered. */
const caller = (name: string, target: string, id = ""): Omit<NotebookJson, "version"> => ({
  id,
  name: PREFIX + name,
  runtime: "node",
  outputs: ["got"],
  steps: [
    {
      id: `${name}-cell`,
      kind: "cell",
      code: `const r = await notebooks.run('${PREFIX}${target}'); return { got: r.from };`,
    },
  ],
});

/** Runs as a trigger would: the deployed version, with callees resolved for production. */
async function runDeployed(id: string) {
  const started = await notebookExecutionService.start(id, () => {}, { triggerSource: "cron" });
  return await started.completed;
}

async function runDraft(id: string) {
  const started = await notebookExecutionService.start(id, () => {}, { triggerSource: "manual" });
  return await started.completed;
}

console.log("\na renamed draft does not break production");

const calleeId = await store(callee("callee", "deployed"));
await notebooksService.deploy(calleeId, "test");
const callerId = await store(caller("caller", "callee"));
await notebooksService.deploy(callerId, "test");

await check("production calls the callee by its deployed name", async () => {
  const result = await runDeployed(callerId);
  assert.equal(result.status, "success", result.errors.join("; "));
  assert.deepEqual(result.outputs, { got: "deployed" });
});

await check("renaming the callee's draft, without deploying, leaves the caller working", async () => {
  await store(callee("callee-renamed", "draft", calleeId));

  const result = await runDeployed(callerId);
  assert.equal(result.status, "success", result.errors.join("; "));
  assert.deepEqual(result.outputs, { got: "deployed" });
});

await check("another draft taking the callee's old name does not make the call ambiguous", async () => {
  await store(callee("callee", "impostor"));

  const result = await runDeployed(callerId);
  assert.equal(result.status, "success", result.errors.join("; "));
  assert.deepEqual(result.outputs, { got: "deployed" });
});

await check("a callee referred to by id still resolves in production", async () => {
  const byId = await store({
    ...caller("by-id", "callee"),
    steps: [
      {
        id: "by-id-cell",
        kind: "cell",
        code: `const r = await notebooks.run('${calleeId}'); return { got: r.from };`,
      },
    ],
  });
  await notebooksService.deploy(byId, "test");

  const result = await runDeployed(byId);
  assert.equal(result.status, "success", result.errors.join("; "));
  assert.deepEqual(result.outputs, { got: "deployed" });
});

await check("deploying the callee under its new name makes the old name stop resolving", async () => {
  await notebooksService.deploy(calleeId, "test");

  const result = await runDeployed(callerId);
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("; "), /not found/i);
});

await check("a name held by two deployed notebooks is ambiguous, and the error says so", async () => {
  const firstId = await store(callee("twin-a", "a"));
  const secondId = await store(callee("twin-b", "b"));
  await notebooksService.deploy(firstId, "test");
  await notebooksService.deploy(secondId, "test");
  // Not reachable through `deploy` once it refuses a clashing name, but older installations
  // may hold such a pair, and the answer to them must stay "ambiguous", not "the first".
  await pool.query(
    `UPDATE notebook_versions SET document = REPLACE(document, $1, $2)
     WHERE id = (SELECT deployed_version_id FROM notebooks WHERE id = $3)`,
    [`${PREFIX}twin-b`, `${PREFIX}twin-a`, secondId]
  );
  const twinCaller = await store(caller("twin-caller", "twin-a"));
  await notebooksService.deploy(twinCaller, "test");

  const result = await runDeployed(twinCaller);
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("; "), /More than one notebook/);
});

await check("an id that names a notebook nobody deployed says so, not 'not found'", async () => {
  const draftOnly = await store(callee("draft-only", "x"));
  const viaId = await store({
    ...caller("via-undeployed-id", "callee"),
    steps: [
      {
        id: "u-cell",
        kind: "cell",
        code: `await notebooks.run('${draftOnly}'); return { got: 'ran' };`,
      },
    ],
  });
  await notebooksService.deploy(viaId, "test");

  const result = await runDeployed(viaId);
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("; "), /not been deployed|not deployed/i);
});

console.log("\na page button follows the deployed name too");

const asking = (name: string, target: string, id = ""): Omit<NotebookJson, "version"> => ({
  id,
  name: PREFIX + name,
  runtime: "node",
  outputs: ["shown"],
  actions: [{ label: "Go", do: "run", notebook: PREFIX + target }],
  steps: [{ id: `${name}-cell`, kind: "cell", code: "return { shown: 1 };" }],
});

const targetDoc = (name: string, id = ""): Omit<NotebookJson, "version"> => ({
  id,
  name: PREFIX + name,
  runtime: "node",
  inputs: [{ name: "amount", type: "number" }],
  outputs: ["from"],
  steps: [{ id: `${name}-cell`, kind: "cell", code: "return { from: 'pressed' };" }],
});

const targetId = await store(targetDoc("button-target"));
await notebooksService.deploy(targetId, "test");
const pageId = await store(asking("button-page", "button-target"));
await notebooksService.deploy(pageId, "test");

async function press(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/notebooks/${pageId}/actions/0`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ args: { amount: 1 } }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function askedBy(): Promise<string[]> {
  const pages = (await (await fetch(`${base}/api/notebooks/pages`, { headers: auth })).json()) as
    NotebookPage[];
  const found = pages.find((page) => page.name === `${PREFIX}button-page`);
  assert.ok(found, "the page is not listed");
  return (found.actions[0].asks ?? []).map((ask) => ask.name);
}

await check("pressing the button runs the target by its deployed name", async () => {
  const { status, body } = await press();
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, "success");
  assert.deepEqual(await askedBy(), ["amount"]);
});

await check("renaming the target's draft leaves both the button and its form working", async () => {
  await store(targetDoc("button-target-renamed", targetId));

  const { status, body } = await press();
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, "success");
  assert.deepEqual(await askedBy(), ["amount"], "the form followed the draft");
});

await check("a button whose target was never deployed answers 409, not 'does not exist'", async () => {
  const draftId = await store(targetDoc("button-undeployed"));
  const undeployedPage = await store({
    ...asking("button-page-2", "button-undeployed"),
    actions: [{ label: "Go", do: "run", notebook: draftId }],
  });
  await notebooksService.deploy(undeployedPage, "test");

  const res = await fetch(`${base}/api/notebooks/${undeployedPage}/actions/0`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(res.status, 409);
});

await check("a button naming a notebook only a draft has is 404", async () => {
  await store(targetDoc("button-draft-name"));
  const page = await store({
    ...asking("button-page-3", "button-draft-name"),
  });
  await notebooksService.deploy(page, "test");

  const res = await fetch(`${base}/api/notebooks/${page}/actions/0`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(res.status, 404);
});

console.log("\ndrafts still resolve drafts");

await check("running a caller by hand reaches the callee under its draft name", async () => {
  const draftCallee = await store(callee("draft-callee", "deployed-v"));
  await notebooksService.deploy(draftCallee, "test");
  await store(callee("draft-callee-v2", "draft-v", draftCallee));
  const draftCaller = await store(caller("draft-caller", "draft-callee-v2"));

  const byHand = await runDraft(draftCaller);
  assert.equal(byHand.status, "success", byHand.errors.join("; "));
  assert.deepEqual(byHand.outputs, { got: "draft-v" });
});

await check("resolving the draft name still refuses an ambiguous one", async () => {
  await store(callee("dup-a", "1", ""));
  await store({ ...callee("dup-a", "2", "") });
  const found = await notebooksService.findByIdOrName(`${PREFIX}dup-a`);
  assert.equal(found, "ambiguous");
});

await cleanup();
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * M8.1 — saving stops being publishing.
 *
 * The claim under test is narrow and worth being sure of: what a webhook runs is the
 * version someone deployed, not whatever was last saved. Everything else here exists to
 * make that claim falsifiable — editing the draft after deploying, and checking which
 * source the run actually recorded.
 *
 * Notebooks it creates are prefixed `zz-dep-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-deploy.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson } from "@zaa-tool/shared";
import { testOwner, dropOwner } from "./owners.js";

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
const OWNER = (await testOwner("notebookdeploy")).id;

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const created: string[] = [];

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document }, "test", OWNER, { expectedRevision: "any" });
  if (!created.includes(id)) created.push(id);
  return id;
}

const notebook = (name: string, slug: string, marker: string): Omit<NotebookJson, "version"> => ({
  id: "",
  name,
  runtime: "node",
  outputs: ["marker"],
  triggers: [{ id: `${slug}-trigger`, kind: "webhook", slug }],
  steps: [{ id: `${slug}-cell`, kind: "cell", code: `return { marker: '${marker}' };` }],
});

/** The run a webhook started, once it has finished writing itself down. */
async function latestRun(notebookId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const runs = await notebookRunsService.listByNotebook(notebookId, 1);
    if (runs[0] && runs[0].status !== "running") {
      return await notebookRunsService.getById(runs[0].id);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("no finished run appeared");
}

console.log("\nthe gate");

await check("a webhook on a notebook nobody deployed is an unknown slug", async () => {
  await store(notebook("zz-dep-undeployed", "zz-dep-open-webhook-slug-1", "draft"));

  const res = await fetch(`${base}/hooks/zz-dep-open-webhook-slug-1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  // FX15: only a deploy puts a trigger in the index, so nothing is listening here. It used
  // to be a 409 "has not been deployed" because the draft's triggers were indexed on save.
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Unknown webhook/);
});

await check("after deploying, the same webhook runs", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-undeployed");
  assert.ok(found && found !== "ambiguous");
  await notebooksService.deploy(found.id, "test");

  const res = await fetch(`${base}/hooks/zz-dep-open-webhook-slug-1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "success");
});

console.log("\nwhat a trigger actually runs");

await check("editing after deploying does not change what the webhook does", async () => {
  const id = await store(notebook("zz-dep-pinned", "zz-dep-open-webhook-slug-2", "deployed-version"));
  await notebooksService.deploy(id, "test");

  // The draft moves on. This is the moment that used to change production.
  await store({ ...notebook("zz-dep-pinned", "zz-dep-open-webhook-slug-2", "draft-version"), id });

  const res = await fetch(`${base}/hooks/zz-dep-open-webhook-slug-2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).outputs, { marker: "deployed-version" });

  const run = await latestRun(id);
  const source = run?.cell_results["zz-dep-open-webhook-slug-2-cell"]?.source ?? "";
  assert.match(source, /deployed-version/, "the webhook ran the draft");
  assert.ok(!source.includes("draft-version"), "the webhook ran the draft");
});

await check("running it by hand runs the draft, which is the point of a draft", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-pinned");
  assert.ok(found && found !== "ambiguous");

  const started = await notebookExecutionService.start(found.id, () => {}, {
    triggerSource: "manual",
  });
  const result = await started.completed;

  assert.equal(result.status, "success");
  assert.deepEqual(result.outputs, { marker: "draft-version" });
});

await check("deploying again moves production to the current draft", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-pinned");
  assert.ok(found && found !== "ambiguous");
  await notebooksService.deploy(found.id, "test");

  const res = await fetch(`${base}/hooks/zz-dep-open-webhook-slug-2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).outputs, { marker: "draft-version" });
});

console.log("\nwhat a webhook answers");

await check("a notebook that declares outputs hands them back to the caller", async () => {
  const id = await store({
    id: "",
    name: "zz-dep-answers",
    runtime: "node",
    inputs: [{ name: "amount", type: "number", required: true }],
    outputs: ["marker", "doubled"],
    triggers: [{ id: "zz-dep-ans-t", kind: "webhook", slug: "zz-dep-open-webhook-slug-5" }],
    steps: [
      {
        id: "zz-dep-ans-cell",
        kind: "cell",
        code: "return { marker: 'answered', doubled: inputs.amount * 2 };",
      },
    ],
  });
  await notebooksService.deploy(id, "test");

  const res = await fetch(`${base}/hooks/zz-dep-open-webhook-slug-5`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 21 }),
  });

  assert.equal(res.status, 200, "the caller was left holding a run id");
  const body = await res.json();
  assert.equal(body.status, "success");
  assert.deepEqual(body.outputs, { marker: "answered", doubled: 42 });
});

await check("a notebook that declares none still answers immediately", async () => {
  const id = await store({
    id: "",
    name: "zz-dep-fireforget",
    runtime: "node",
    triggers: [{ id: "zz-dep-ff-t", kind: "webhook", slug: "zz-dep-open-webhook-slug-6" }],
    steps: [{ id: "zz-dep-ff-cell", kind: "cell", code: "return {};" }],
  });
  await notebooksService.deploy(id, "test");

  const res = await fetch(`${base}/hooks/zz-dep-open-webhook-slug-6`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(res.status, 202, "waited for a notebook with nothing to say");
  assert.equal((await res.json()).status, "started");
});

await check("a failing notebook reports the failure rather than a cheerful run id", async () => {
  const id = await store({
    id: "",
    name: "zz-dep-broken",
    runtime: "node",
    outputs: ["never"],
    triggers: [{ id: "zz-dep-broken-t", kind: "webhook", slug: "zz-dep-open-webhook-slug-7" }],
    steps: [{ id: "zz-dep-broken-cell", kind: "cell", code: "throw new Error('nope');" }],
  });
  await notebooksService.deploy(id, "test");

  const res = await fetch(`${base}/hooks/zz-dep-open-webhook-slug-7`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.status, "failed");
  // The caller of a webhook is told only that it failed (L-05); the text stays in the run.
  assert.match(String(body.error), /^Run failed \(run [0-9a-f-]{36}\)$/);
  assert.doesNotMatch(JSON.stringify(body), /nope/);
});

console.log("\nwhat the editor is told");

await check("deploy state reports who, when, and whether the draft has moved on", async () => {
  const id = await store(notebook("zz-dep-state", "zz-dep-open-webhook-slug-3", "one"));

  const before = await notebooksService.getDeployState(id);
  assert.deepEqual(
    { isDeployed: before?.isDeployed, changed: before?.hasUndeployedChanges },
    { isDeployed: false, changed: true }
  );

  await notebooksService.deploy(id, "afriza");
  const justDeployed = await notebooksService.getDeployState(id);
  assert.equal(justDeployed?.isDeployed, true);
  assert.equal(justDeployed?.deployedBy, "afriza");
  assert.equal(justDeployed?.hasUndeployedChanges, false, "nothing changed, yet it says it did");

  await store({ ...notebook("zz-dep-state", "zz-dep-open-webhook-slug-3", "two"), id });
  const afterEdit = await notebooksService.getDeployState(id);
  assert.equal(afterEdit?.hasUndeployedChanges, true);
});

await check("saving without changing anything does not ask to be deployed again", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-state");
  assert.ok(found && found !== "ambiguous");
  await notebooksService.deploy(found.id, "afriza");

  const document = notebooksService.parseDocument(found);
  await notebooksService.save({ ...document }, undefined, undefined, { expectedRevision: "any" });

  const state = await notebooksService.getDeployState(found.id);
  assert.equal(state?.hasUndeployedChanges, false);
});

console.log("\nthe chain agrees with itself");

await check("a triggered run calls the callee's deployed version, not its draft", async () => {
  const calleeId = await store({
    id: "",
    name: "zz-dep-callee",
    runtime: "node",
    outputs: ["from"],
    steps: [{ id: "zz-dep-callee-cell", kind: "cell", code: "return { from: 'deployed' };" }],
  });
  await notebooksService.deploy(calleeId, "test");
  await store({
    id: calleeId,
    name: "zz-dep-callee",
    runtime: "node",
    outputs: ["from"],
    steps: [{ id: "zz-dep-callee-cell", kind: "cell", code: "return { from: 'draft' };" }],
  });

  const callerId = await store({
    id: "",
    name: "zz-dep-caller",
    runtime: "node",
    outputs: ["got"],
    triggers: [{ id: "zz-dep-caller-trigger", kind: "webhook", slug: "zz-dep-open-webhook-slug-4" }],
    steps: [
      {
        id: "zz-dep-caller-cell",
        kind: "cell",
        code: "const r = await notebooks.run('zz-dep-callee'); return { got: r.from };",
      },
    ],
  });
  await notebooksService.deploy(callerId, "test");

  const res = await fetch(`${base}/hooks/zz-dep-open-webhook-slug-4`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).outputs, { got: "deployed" });
});

await check("running that same caller by hand reaches the callee's draft", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-caller");
  assert.ok(found && found !== "ambiguous");

  const started = await notebookExecutionService.start(found.id, () => {}, {
    triggerSource: "manual",
  });
  const result = await started.completed;
  assert.deepEqual(result.outputs, { got: "draft" });
});

// ── coming back out ───────────────────────────────────────────────────────────

console.log("\nundeploy");

await check("the deploy state names what production is serving", async () => {
  const id = await store({
    id: "",
    name: "zz-dep-serving",
    runtime: "node",
    inputs: [{ name: "a", type: "number" }],
    outputs: ["doubled"],
    triggers: [{ id: "t1", kind: "cron", cron: "0 6 * * *", enabled: true }],
    steps: [{ id: "c1", kind: "cell", code: "return { doubled: inputs.a * 2 };" }],
  });
  await notebooksService.deploy(id, "test");

  const state = await notebooksService.getDeployState(id);
  assert.equal(state?.serving?.toolName, "run_zz_dep_serving");
  assert.equal(state?.serving?.hasPage, true);
  assert.deepEqual(state?.serving?.triggers, [{ kind: "cron", label: "0 6 * * *" }]);
});

await check("undeploying stops production and leaves the draft alone", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-serving");
  assert.ok(found && found !== "ambiguous");

  const result = await notebooksService.undeploy(found.id);
  assert.equal(result?.wasDeployed, true);

  const state = await notebooksService.getDeployState(found.id);
  assert.equal(state?.isDeployed, false);
  assert.equal(await notebooksService.getDeployedDocument(found.id), null);

  // The point of it being separate from delete.
  const record = await notebooksService.getById(found.id);
  assert.ok(record, "undeploying removed the notebook");
  assert.equal(notebooksService.parseDocument(record).name, "zz-dep-serving");
});

await check("a trigger on an undeployed notebook refuses rather than running the draft", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-serving");
  assert.ok(found && found !== "ambiguous");

  await assert.rejects(
    notebookExecutionService.start(found.id, () => {}, { triggerSource: "cron" }),
    (err: unknown) => (err as Error).name === "NotebookNotDeployedError"
  );
});

await check("undeploying twice is not an error, and says it changed nothing", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-serving");
  assert.ok(found && found !== "ambiguous");
  assert.deepEqual(await notebooksService.undeploy(found.id), { wasDeployed: false });
});

await check("a notebook that never existed is not found", async () => {
  assert.equal(await notebooksService.undeploy("no-such-notebook"), null);
});

await check("redeploying brings it back", async () => {
  const found = await notebooksService.findByIdOrName("zz-dep-serving");
  assert.ok(found && found !== "ambiguous");

  await notebooksService.deploy(found.id, "test");
  const state = await notebooksService.getDeployState(found.id);
  assert.equal(state?.isDeployed, true);
  assert.equal(state?.serving?.toolName, "run_zz_dep_serving");
});

for (const id of created) await notebooksService.delete(id).catch(() => {});
await dropOwner("notebookdeploy");
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

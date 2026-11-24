/**
 * FX-26 — every run records the deployed version it actually executed.
 *
 * Draft runs stay null, nested production runs use the callee's pinned version, and the
 * public projections do not disclose the version id. Fixtures use `zz-fx26-run-` and are
 * removed before and after the suite.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/fx26-run-version.test.ts
 */
import assert from "node:assert/strict";
import type { NotebookJson, NotebookRunDetail, NotebookRunTrigger } from "@zaa-tool/shared";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { publicSummary, publicView } from "../src/core/run-projection.js";
import { dropOwner, testOwner } from "./owners.js";

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

await initDb();
await initDb();
const OWNER = await testOwner("fx26runversion");
const created: string[] = [];

async function removeFixtures(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM notebooks WHERE name LIKE 'zz-fx26-run-%'"
  );
  for (const row of rows) await notebooksService.delete(row.id).catch(() => {});
}
await removeFixtures();

function document(name: string, marker: string): Omit<NotebookJson, "version"> {
  return {
    id: "",
    name,
    runtime: "node",
    outputs: ["marker"],
    steps: [{ id: `${name}-cell`, kind: "cell", code: `return { marker: '${marker}' };` }],
  };
}

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

async function run(
  notebookId: string,
  triggerSource: NotebookRunTrigger
): Promise<NotebookRunDetail> {
  const started = await notebookExecutionService.start(notebookId, () => {}, {
    triggerSource,
    startedBy: OWNER.id,
  });
  const result = await started.completed;
  assert.equal(result.status, "success", result.errors.join("\n"));
  const row = await notebookRunsService.getById(started.runId);
  assert.ok(row, "the run row was not recorded");
  return row;
}

let appId = "";
let productionRun: NotebookRunDetail | null = null;
let calleeId = "";
let callerId = "";
let firstCalleeVersionId = "";

console.log("\nFX-26: run version trace");

await check("a webhook run records the version that production had pinned", async () => {
  appId = await store(document("zz-fx26-run-app", "one"));
  const deployed = await notebooksService.deploy(appId, OWNER.username, OWNER.id);
  assert.ok(deployed);
  productionRun = await run(appId, "webhook");
  const state = await notebooksService.getDeployState(appId);
  assert.equal(state?.versionId, deployed.versionId);
  assert.equal(productionRun.version_id, state?.versionId);
});

await check("a draft run records null instead of the deployed version", async () => {
  const draft = await run(appId, "manual");
  assert.equal(draft.version_id, null);
});

await check("a production callee records its own pinned version, not its caller's", async () => {
  calleeId = await store(document("zz-fx26-run-callee", "deployed"));
  const calleeDeploy = await notebooksService.deploy(calleeId, OWNER.username, OWNER.id);
  assert.ok(calleeDeploy);
  firstCalleeVersionId = calleeDeploy.versionId;

  callerId = await store({
    id: "",
    name: "zz-fx26-run-caller",
    runtime: "node",
    outputs: ["marker"],
    steps: [
      {
        id: "zz-fx26-run-caller-cell",
        kind: "cell",
        code: "const called = await notebooks.run('zz-fx26-run-callee'); return { marker: called.marker };",
      },
    ],
  });
  const callerDeploy = await notebooksService.deploy(callerId, OWNER.username, OWNER.id);
  assert.ok(callerDeploy);
  const callerRun = await run(callerId, "webhook");
  assert.equal(callerRun.outputs?.marker, "deployed");

  const calleeRuns = await notebookRunsService.listByNotebook(calleeId, 1);
  assert.equal(calleeRuns[0]?.parent_run_id, callerRun.id);
  assert.equal(calleeRuns[0]?.version_id, firstCalleeVersionId);
  assert.notEqual(calleeRuns[0]?.version_id, callerDeploy.versionId);
});

await check("redeploying makes the next production run record the new version", async () => {
  await store({ ...document("zz-fx26-run-callee", "second"), id: calleeId });
  const redeployed = await notebooksService.deploy(calleeId, OWNER.username, OWNER.id);
  assert.ok(redeployed);
  assert.notEqual(redeployed.versionId, firstCalleeVersionId);

  const callerRun = await run(callerId, "webhook");
  assert.equal(callerRun.outputs?.marker, "second");
  const calleeRuns = await notebookRunsService.listByNotebook(calleeId, 1);
  assert.equal(calleeRuns[0]?.parent_run_id, callerRun.id);
  assert.equal(calleeRuns[0]?.version_id, redeployed.versionId);
  assert.notEqual(calleeRuns[0]?.version_id, firstCalleeVersionId);
});

await check("public run projections never include version_id", () => {
  assert.ok(productionRun, "the production run fixture was not recorded");
  const run = {
    ...productionRun,
    version_id: productionRun.version_id ?? "zz-fx26-run-version-for-projection",
  };
  const summary = publicSummary(run) as unknown as Record<string, unknown>;
  const detail = publicView(run, null) as unknown as Record<string, unknown>;
  assert.equal(Object.hasOwn(summary, "version_id"), false);
  assert.equal(Object.hasOwn(detail, "version_id"), false);
});

await removeFixtures();
await dropOwner("fx26runversion");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * A root run has an overall deadline (MAX_RUN_SECONDS), covering nested calls too.
 * Before: a cell's timer paused while it awaited `notebooks.run`, so
 * `while (true) await notebooks.run(...)` never timed out and held a gate slot forever.
 *
 * Rows it creates are prefixed `zz-k10-` and deleted at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test run-deadline
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import {
  makeCheck,
  watchdog,
  cleanupNotebooks,
  store,
  waitFor,
  alive,
  killPid,
  finishedRun,
  readPid,
  sleep,
} from "./k10-helpers.js";

// Read at call time by config.ts, so setting it here is early enough.
process.env.MAX_RUN_SECONDS = "3";
const wd = watchdog(120_000);
const { check, tally } = makeCheck();
const spawned: number[] = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-k10-"));

await initDb();
await cleanupNotebooks();

const calleeId = await store({
  name: "zz-k10-callee",
  outputs: ["n"],
  steps: [{ id: "c1", kind: "cell", code: "return { n: 1 };" }],
});
const loopId = await store({
  name: "zz-k10-loop",
  steps: [
    {
      id: "l1",
      kind: "cell",
      timeoutMs: 600_000,
      code: `while (true) { await notebooks.run(${JSON.stringify(calleeId)}); }`,
    },
  ],
});

console.log("\noverall run deadline");

await check("a cell that loops on notebooks.run fails with the deadline error and frees its slot", async () => {
  const t0 = Date.now();
  const { runId } = await notebookExecutionService.start(loopId, () => {}, { triggerSource: "manual" });
  const run = await finishedRun(runId, 20_000);
  assert.ok(run, "the run never ended");
  const took = Date.now() - t0;
  assert.equal(run!.status, "failed");
  assert.match(run!.error ?? "", /Run exceeded its overall deadline of 3 s/);
  assert.ok(took < 12_000, `took ${took} ms`);

  // Give an in-flight nested row a moment to settle, then none may be left `running`.
  await sleep(1_000);
  const rows = await pool.query(
    "SELECT status FROM notebook_runs WHERE notebook_id = $1 AND status = 'running'",
    [calleeId]
  );
  assert.equal(rows.rowCount, 0, "a nested run row is still running");

  // The gate slot is free: a following run starts and finishes.
  const quick = await notebookExecutionService.start(calleeId, () => {}, { triggerSource: "manual" });
  const result = await Promise.race([quick.completed, sleep(8_000).then(() => null)]);
  assert.ok(result, "the following run never started");
  assert.equal(result!.status, "success");
});

await check("a Python cell sleeping past the deadline, with a large cell timeout, is killed", async () => {
  const marker = path.join(dir, "py.pid").replace(/\\/g, "/");
  const code = [
    "import time, os",
    `open(r'${marker}','w').write(str(os.getpid()))`,
    "time.sleep(120)",
  ].join("\n");
  const id = await store({
    name: "zz-k10-pysleep",
    runtime: "python",
    steps: [{ id: "p1", kind: "cell", timeoutMs: 600_000, code }],
  });
  const t0 = Date.now();
  const { runId } = await notebookExecutionService.start(id, () => {}, { triggerSource: "manual" });
  const pid = await waitFor(() => readPid(marker), 8_000);
  assert.ok(pid, "python never wrote its pid");
  spawned.push(pid!);
  const run = await finishedRun(runId, 20_000);
  assert.ok(run, "the run never ended");
  assert.equal(run!.status, "failed");
  assert.match(run!.error ?? "", /overall deadline/);
  assert.ok(Date.now() - t0 < 15_000);
  const gone = await waitFor(() => (alive(pid!) ? undefined : true), 8_000);
  assert.equal(gone, true, `python ${pid} still running`);
});

await check("a normal short run is unaffected", async () => {
  const { runId, completed } = await notebookExecutionService.start(calleeId, () => {}, {
    triggerSource: "manual",
  });
  const result = await completed;
  assert.equal(result.status, "success");
  assert.deepEqual(result.outputs, { n: 1 });
  await sleep(4_000); // past the deadline: a settled run must not be rewritten
  const run = await notebookRunsService.getById(runId);
  assert.equal(run!.status, "success");
});

for (const pid of spawned) killPid(pid);
await cleanupNotebooks();
fs.rmSync(dir, { recursive: true, force: true });
clearTimeout(wd);
console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
await pool.end().catch(() => {});
process.exit(tally.failed === 0 ? 0 : 1);

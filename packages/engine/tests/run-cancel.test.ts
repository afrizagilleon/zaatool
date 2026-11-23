/**
 * `POST /api/notebooks/:id/runs/:runId/cancel` stops a running root run, creator only.
 * Before: there was no way to stop a run short of restarting the engine.
 *
 * Rows it creates are prefixed `zz-k10-` and deleted at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test run-cancel
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { authService } from "../src/services/auth.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
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
  setOwner,
} from "./k10-helpers.js";

const wd = watchdog(150_000);
const { check, tally } = makeCheck();
const spawned: number[] = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-k10-"));
// Where cells change uid they are another user: this is the folder a cell writes its pid to, so it
// must be one any user can write (the engine, root, reads it).
fs.chmodSync(dir, 0o777);

await initDb();
await cleanupNotebooks();

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const CREATOR = "zz-k10-creator";
const VIEWER = "zz-k10-viewer";
const PASSWORD = "zz-k10-password";
for (const [username, role] of [[CREATOR, "creator"], [VIEWER, "viewer"]] as const) {
  await pool.query("DELETE FROM users WHERE username = $1", [username]);
  const created = await authService.createUser(username, PASSWORD, role);
  if (username === CREATOR) setOwner(created.id);
}
const asCreator = { Authorization: `Bearer ${(await authService.login(CREATOR, PASSWORD)).token}` };
const asViewer = { Authorization: `Bearer ${(await authService.login(VIEWER, PASSWORD)).token}` };

function cancel(headers: Record<string, string>, id: string, runId: string) {
  return fetch(`${base}/api/notebooks/${id}/runs/${runId}/cancel`, { method: "POST", headers });
}

// Bounded by their own cell timeouts, so a build with no cancel route still ends them.
const jsId = await store({
  name: "zz-k10-js-long",
  steps: [
    {
      id: "j1",
      kind: "cell",
      timeoutMs: 40_000,
      code: "await new Promise((r) => setTimeout(r, 30000)); return {};",
    },
  ],
});
const otherId = await store({
  name: "zz-k10-other",
  steps: [{ id: "o1", kind: "cell", code: "return {};" }],
});

console.log("\ncancelling a run");

await check("a creator cancels a long JS run: it ends failed 'Cancelled by <user>'", async () => {
  const { runId } = await notebookExecutionService.start(jsId, () => {}, { triggerSource: "manual" });
  await sleep(500);
  const t0 = Date.now();
  const res = await cancel(asCreator, jsId, runId);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { cancelled: true });
  const run = await finishedRun(runId, 10_000);
  assert.ok(run, "the run never ended");
  assert.equal(run!.status, "failed");
  assert.equal(run!.error, `Cancelled by ${CREATOR}`);
  assert.ok(Date.now() - t0 < 8_000, "cancel was not prompt");
});

await check("a creator cancels a Python run with a grandchild: the whole tree is gone", async () => {
  const marker = path.join(dir, "grandchild.pid").replace(/\\/g, "/");
  const code = [
    "import subprocess, sys, time",
    `subprocess.Popen([sys.executable, "-c", "import time; open(r'${marker}','w').write(str(__import__('os').getpid())); time.sleep(120)"])`,
    "time.sleep(120)",
  ].join("\n");
  const pyId = await store({
    name: "zz-k10-py-long",
    runtime: "python",
    steps: [{ id: "p1", kind: "cell", timeoutMs: 100_000, code }],
  });
  const { runId } = await notebookExecutionService.start(pyId, () => {}, { triggerSource: "manual" });
  const pid = await waitFor(() => readPid(marker), 10_000);
  assert.ok(pid, "the grandchild never wrote its pid");
  spawned.push(pid!);

  const res = await cancel(asCreator, pyId, runId);
  assert.equal(res.status, 202);
  const run = await finishedRun(runId, 10_000);
  assert.ok(run, "the run never ended");
  assert.equal(run!.status, "failed");
  assert.equal(run!.error, `Cancelled by ${CREATOR}`);
  const gone = await waitFor(() => (alive(pid!) ? undefined : true), 8_000);
  assert.equal(gone, true, `grandchild ${pid} is still running`);
});

await check("a viewer gets 403 and the run keeps going", async () => {
  const { runId } = await notebookExecutionService.start(jsId, () => {}, { triggerSource: "manual" });
  await sleep(300);
  const res = await cancel(asViewer, jsId, runId);
  assert.equal(res.status, 403);
  const row = await pool.query("SELECT status FROM notebook_runs WHERE id = $1", [runId]);
  assert.equal(row.rows[0].status, "running");
  const ok = await cancel(asCreator, jsId, runId);
  assert.equal(ok.status, 202);
  await finishedRun(runId, 10_000);
});

await check("a run id under the wrong notebook is 404, and unknown run is 404", async () => {
  const { runId } = await notebookExecutionService.start(jsId, () => {}, { triggerSource: "manual" });
  await sleep(300);
  assert.equal((await cancel(asCreator, otherId, runId)).status, 404);
  assert.equal((await cancel(asCreator, jsId, "00000000-0000-4000-8000-000000000000")).status, 404);
  const row = await pool.query("SELECT status FROM notebook_runs WHERE id = $1", [runId]);
  assert.equal(row.rows[0].status, "running", "the wrong-notebook cancel stopped the run");
  assert.equal((await cancel(asCreator, jsId, runId)).status, 202);
  await finishedRun(runId, 10_000);
});

await check("a finished run is 409", async () => {
  const { runId, completed } = await notebookExecutionService.start(otherId, () => {}, {
    triggerSource: "manual",
  });
  await completed;
  await finishedRun(runId, 5_000);
  assert.equal((await cancel(asCreator, otherId, runId)).status, 409);
});

await check("a nested run id is 409 and the root keeps running", async () => {
  const slowCalleeId = await store({
    name: "zz-k10-slow-callee",
    steps: [
      {
        id: "s1",
        kind: "cell",
        timeoutMs: 40_000,
        code: "await new Promise((r) => setTimeout(r, 30000)); return {};",
      },
    ],
  });
  const callerId = await store({
    name: "zz-k10-caller",
    steps: [
      {
        id: "k1",
        kind: "cell",
        timeoutMs: 40_000,
        code: `await notebooks.run(${JSON.stringify(slowCalleeId)}); return {};`,
      },
    ],
  });
  const { runId } = await notebookExecutionService.start(callerId, () => {}, { triggerSource: "manual" });
  const nested = await waitFor(async () => {
    const { rows } = await pool.query(
      "SELECT id FROM notebook_runs WHERE notebook_id = $1 AND status = 'running'",
      [slowCalleeId]
    );
    return rows[0]?.id as string | undefined;
  }, 10_000);
  assert.ok(nested, "the nested run never started");
  const res = await cancel(asCreator, slowCalleeId, nested!);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /cancel the run that started it/);
  const root = await pool.query("SELECT status FROM notebook_runs WHERE id = $1", [runId]);
  assert.equal(root.rows[0].status, "running");

  // Cancelling the root takes the nested run down with it.
  assert.equal((await cancel(asCreator, callerId, runId)).status, 202);
  const done = await finishedRun(runId, 10_000);
  assert.equal(done!.error, `Cancelled by ${CREATOR}`);
  const child = await finishedRun(nested!, 10_000);
  assert.ok(child, "the nested run row is still running");
  assert.equal(child!.status, "failed");
});

for (const pid of spawned) killPid(pid);
await cleanupNotebooks();
await pool.query("DELETE FROM users WHERE username IN ($1, $2)", [CREATOR, VIEWER]);
fs.rmSync(dir, { recursive: true, force: true });
server.close();
clearTimeout(wd);
console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
await pool.end().catch(() => {});
process.exit(tally.failed === 0 ? 0 : 1);

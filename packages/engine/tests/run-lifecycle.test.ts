/**
 * How runs are recorded, closed, followed and cancelled (C-04, C-05, C-14, C-15, C-16).
 *
 * Before: pruning could delete a run that was still going; a restart left `running` rows
 * forever; a client that followed a run a minute after it ended never heard it end; one
 * production run could see two versions of the same callee; `cancel` said "cancelled" for a
 * run that went on to succeed.
 *
 * Rows it creates are named `zz-w2run-…` and accounts `zz-own-w2…`; all are removed at the
 * start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test run-lifecycle
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebookExecutionService as svc } from "../src/services/notebook-execution.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { WebSocketManager } from "../src/server/websocket-manager.js";
import { makeCheck, watchdog, sleep } from "./k10-helpers.js";
import { testOwner, dropOwner } from "./owners.js";
import type { NotebookJson } from "@zaa-tool/shared";

const wd = watchdog(150_000);
const { check, tally } = makeCheck();

async function cleanup(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-w2run-%'");
  for (const row of rows) {
    await notebookRunsService.deleteByNotebook(row.id).catch(() => {});
    await notebooksService.delete(row.id).catch(() => {});
  }
  await pool.query("DELETE FROM notebook_runs WHERE id LIKE 'zz-w2run-%'");
  await dropOwner("w2a");
}

async function save(owner: string, name: string, code: string, outputs: string[] = []): Promise<string> {
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name,
      runtime: "node",
      outputs,
      steps: [{ id: "c1", kind: "cell", timeoutMs: 60_000, code }],
    } as unknown as NotebookJson,
    "test",
    owner
  );
  return saved.id;
}

await initDb();
await cleanup();
const A = await testOwner("w2a");

console.log("\nrun history");

await check("pruning never deletes a run that is still going", async () => {
  const slow = await save(A.id, "zz-w2run-prune", "await new Promise(r=>setTimeout(r,3000)); return {};");
  const long = await svc.start(slow, () => {}, { triggerSource: "manual" });
  await sleep(300);
  for (let i = 0; i < 55; i += 1) {
    const id = `zz-w2run-q${i}`;
    await notebookRunsService.start({ runId: id, notebookId: slow, triggerSource: "cron" });
    await notebookRunsService.finish(id, "success");
  }
  assert.equal((await notebookRunsService.getById(long.runId))?.status, "running", "its row was pruned");
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM notebook_runs WHERE notebook_id = $1 AND status <> 'running'",
    [slow]
  );
  // Pruned when a run starts, so the one that just finished is still counted.
  assert.ok(rows[0].n <= 51, `${rows[0].n} finished rows kept`);
  assert.equal((await long.completed).status, "success");
  const after = await notebookRunsService.getById(long.runId);
  assert.equal(after?.status, "success", "its result was lost");
});

await check("at boot, a run left running by the previous process is closed as failed", async () => {
  await pool.query(
    "INSERT INTO notebook_runs (id, notebook_id, status, trigger_source) VALUES ('zz-w2run-dead', 'zz-w2run-x', 'running', 'manual')"
  );
  await pool.query(
    "INSERT INTO notebook_runs (id, notebook_id, status, trigger_source, finished_at) VALUES ('zz-w2run-ok', 'zz-w2run-x', 'success', 'manual', now())"
  );
  const closed = await notebookRunsService.failInterrupted();
  assert.ok(closed >= 1);
  const dead = await notebookRunsService.getById("zz-w2run-dead");
  assert.equal(dead?.status, "failed");
  assert.match(dead?.error ?? "", /the engine restarted while this run was in progress/);
  assert.ok(dead?.finished_at);
  assert.equal((await notebookRunsService.getById("zz-w2run-ok"))?.status, "success");
});

console.log("\nfollowing a run");

await check("a client that subscribes after the hub forgot the run is told how it ended", async () => {
  const ok = await save(A.id, "zz-w2run-ws-ok", "return {};");
  const bad = await save(A.id, "zz-w2run-ws-bad", "throw new Error('boom');");
  const server = http.createServer();
  const hub = new RunEventHub(); // never saw these runs: the same as a channel dropped after a minute
  new WebSocketManager(server, hub);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const okRun = await svc.start(ok, () => {}, { triggerSource: "manual", startedBy: A.id });
    const badRun = await svc.start(bad, () => {}, { triggerSource: "manual", startedBy: A.id });
    await okRun.completed;
    await badRun.completed;

    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`);
    const messages: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => socket.on("open", () => resolve()));
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    socket.send(JSON.stringify({ action: "auth", token: A.token }));
    socket.send(JSON.stringify({ action: "subscribe", runId: okRun.runId }));
    socket.send(JSON.stringify({ action: "subscribe", runId: badRun.runId }));
    await sleep(600);
    socket.close();

    const done = messages.find((m) => m.runId === okRun.runId);
    const failed = messages.find((m) => m.runId === badRun.runId);
    assert.equal(done?.type, "run:done");
    assert.equal(done?.status, "success");
    assert.equal(failed?.type, "run:error");
    assert.match(String(failed?.error), /boom/);
  } finally {
    server.close();
  }
});

console.log("\nversions within one run");

await check("a deploy mid-run does not change the callee a production run already used", async () => {
  const callee = await save(A.id, "zz-w2run-callee", "return {v:'v1'};", ["v"]);
  await notebooksService.deploy(callee, "test");
  const caller = await save(
    A.id,
    "zz-w2run-caller",
    "const a = await notebooks.run('zz-w2run-callee'); await new Promise(r=>setTimeout(r,1500)); const b = await notebooks.run('zz-w2run-callee'); return {a: a.v, b: b.v};",
    ["a", "b"]
  );
  await notebooksService.deploy(caller, "test");

  let redeploy: Promise<unknown> | null = null;
  const run = await svc.start(
    caller,
    (event) => {
      // The first call has just finished; the caller is now sleeping before its second.
      if (event.type === "run:done" && event.notebookId === callee && !redeploy) {
        redeploy = (async () => {
          const doc = notebooksService.parseDocument((await notebooksService.getById(callee))!);
          (doc.steps[0] as { code: string }).code = "return {v:'v2'};";
          await notebooksService.save(doc, "test", A.id);
          await notebooksService.deploy(callee, "test");
        })();
      }
    },
    { triggerSource: "tool" }
  );
  const result = await run.completed;
  await redeploy;
  assert.equal(result.status, "success", result.errors.join("; "));
  assert.deepEqual(result.outputs, { a: "v1", b: "v1" });

  const next = await svc.start(caller, () => {}, { triggerSource: "tool" });
  assert.equal((await next.completed).outputs.a, "v2", "the next run should see the new deploy");
});

console.log("\ncancel");

await check("cancel reports success only when the run really ended cancelled", async () => {
  const quick = await save(A.id, "zz-w2run-cancel-quick", "return {};");
  let runId = "";
  let answer: Promise<unknown> | null = null;
  // The run has finished its last cell and said so; the cancel arrives in that instant.
  const run = await svc.start(
    quick,
    (event) => {
      if (event.type === "run:done" && event.runId === runId && !answer) answer = svc.cancel(runId, "test");
    },
    { triggerSource: "manual" }
  );
  runId = run.runId;
  const result = await run.completed;
  assert.equal(result.status, "success");
  assert.deepEqual(await answer, { outcome: "finished", status: "success" });

  const slow = await save(A.id, "zz-w2run-cancel-slow", "await new Promise(r=>setTimeout(r,20000)); return {};");
  const long = await svc.start(slow, () => {}, { triggerSource: "manual" });
  await sleep(800);
  assert.deepEqual(await svc.cancel(long.runId, "test"), { outcome: "cancelled" });
  assert.equal((await long.completed).status, "failed");
  assert.equal((await notebookRunsService.getById(long.runId))?.status, "failed", "settled by the time cancel answered");
  assert.deepEqual(await svc.cancel(long.runId, "test"), { outcome: "not-active" });
});

await cleanup();
clearTimeout(wd);
console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
await pool.end().catch(() => {});
process.exit(tally.failed === 0 ? 0 : 1);

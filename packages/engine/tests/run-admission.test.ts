/**
 * Who gets a run slot (C-02, C-03, C-11).
 *
 * Before: 150 parallel webhook hits were all accepted (the bound was checked, then taken
 * after several awaits); one owner could fill the gate and get every other account refused;
 * a cron whose run outlasted its period piled up a copy per tick; a notebook of a
 * deactivated account kept answering its webhooks and crons.
 *
 * Rows it creates are named `zz-w2run-…` and accounts `zz-own-w2…`; all are removed at the
 * start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test run-admission
 */
import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import {
  notebookExecutionService as svc,
  OwnerInactiveError,
  TooManyRunsError,
} from "../src/services/notebook-execution.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { authService } from "../src/services/auth.service.js";
import { SchedulerService } from "../src/services/scheduler.service.js";
import type { TriggerRecord } from "../src/services/notebook-triggers.service.js";
import { makeCheck, watchdog } from "./k10-helpers.js";
import { testOwner, dropOwner } from "./owners.js";
import type { NotebookJson } from "@zaa-tool/shared";

const wd = watchdog(180_000);
const { check, tally } = makeCheck();

async function cleanup(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-w2run-%'");
  for (const row of rows) {
    await notebookRunsService.deleteByNotebook(row.id).catch(() => {});
    await notebooksService.delete(row.id).catch(() => {});
  }
  for (const label of ["w2a", "w2b", "w2c"]) await dropOwner(label);
}

async function deployed(owner: string, name: string, code: string): Promise<string> {
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name,
      runtime: "node",
      outputs: [],
      steps: [{ id: "c1", kind: "cell", timeoutMs: 60_000, code }],
    } as unknown as NotebookJson,
    "test",
    owner
  );
  await notebooksService.deploy(saved.id, "test");
  return saved.id;
}

await initDb();
await cleanup();
const A = await testOwner("w2a");
const B = await testOwner("w2b");
const slowA = await deployed(A.id, "zz-w2run-slow-a", "await new Promise(r=>setTimeout(r,2500)); return {};");
const quickB = await deployed(B.id, "zz-w2run-quick-b", "return {};");

const started: { runId: string; completed: Promise<unknown> }[] = [];
async function stopAll(): Promise<void> {
  await Promise.all(started.map((s) => svc.cancel(s.runId, "test")));
  await Promise.all(started.map((s) => s.completed));
  started.length = 0;
}

console.log("\nrun admission");

await check("a burst of parallel webhook hits is bounded, not accepted wholesale", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 60 }, () => svc.start(slowA, () => {}, { triggerSource: "webhook" }))
  );
  for (const r of results) if (r.status === "fulfilled") started.push(r.value);
  const refused = results.filter((r) => r.status === "rejected");
  assert.ok(refused.every((r) => (r as PromiseRejectedResult).reason instanceof TooManyRunsError));
  assert.equal(started.length, 12, `accepted ${started.length}; one owner may hold 2 running + 10 queued`);
});

await check("with one owner at its limit, another account's run is still accepted and runs", async () => {
  const other = await svc.start(quickB, () => {}, { triggerSource: "webhook" });
  const result = await Promise.race([other.completed, new Promise<null>((r) => setTimeout(() => r(null), 20_000))]);
  assert.equal(result?.status, "success", "the other account's run waited behind the first owner's queue");
});

await check("the first owner is refused for as long as its own limit holds", async () => {
  await assert.rejects(() => svc.start(slowA, () => {}, { triggerSource: "webhook" }), TooManyRunsError);
  await stopAll();
  const again = await svc.start(slowA, () => {}, { triggerSource: "webhook" });
  started.push(again);
  await stopAll();
});

await check("a cron tick is skipped while the notebook's previous cron run is still going", async () => {
  const trigger = {
    id: "t", notebook_id: slowA, kind: "cron", cron: "* * * * *", slug: null, secret_key: null, enabled: true,
  } as TriggerRecord;
  let fired = 0;
  const scheduler = new SchedulerService({
    listCron: async () => [trigger],
    startRun: async (id, publish, options) => {
      fired += 1;
      const run = await svc.start(id, publish, options);
      started.push(run);
      return run;
    },
    hasRunInFlight: (id) => svc.hasCronRunInFlight(id),
  });
  const base = Math.floor(Date.now() / 60_000) * 60_000;
  scheduler.begin(() => {}, new Date(base));
  await scheduler.tick(new Date(base + 60_000));
  assert.equal(fired, 1);
  await scheduler.tick(new Date(base + 120_000));
  await scheduler.tick(new Date(base + 180_000));
  assert.equal(fired, 1, "the next ticks started copies behind a run that was still going");
  await stopAll();
  assert.equal(svc.hasCronRunInFlight(slowA), false);
  await scheduler.tick(new Date(base + 240_000));
  assert.equal(fired, 2, "once the run is over the next tick fires again");
  await stopAll();
});

await check("a trigger run for a deactivated owner's notebook is refused; a manual run is not", async () => {
  const C = await testOwner("w2c");
  const id = await deployed(C.id, "zz-w2run-inactive-c", "return {};");
  await authService.setActive(C.id, false);
  for (const triggerSource of ["cron", "webhook", "page"] as const) {
    await assert.rejects(
      () => svc.start(id, () => {}, { triggerSource }),
      (err: unknown) => err instanceof OwnerInactiveError && /deactivated/.test((err as Error).message),
      triggerSource
    );
  }
  const manual = await svc.start(id, () => {}, { triggerSource: "manual", startedBy: C.id });
  assert.equal((await manual.completed).status, "success");
});

await check("refused starts leave nothing behind in the gate or the history", async () => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM notebook_runs WHERE status = 'running'");
  assert.equal(rows[0].n, 0);
  const run = await svc.start(quickB, () => {}, { triggerSource: "webhook" });
  assert.equal((await run.completed).status, "success");
});

await cleanup();
clearTimeout(wd);
console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
await pool.end().catch(() => {});
process.exit(tally.failed === 0 ? 0 : 1);

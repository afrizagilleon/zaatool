/**
 * A cron start is queued, not dropped, when the run gate is full; a webhook start in the
 * same state is still refused with TooManyRunsError.
 * Before: both were refused, and the scheduler only logged the cron's failure, so the
 * scheduled run was lost.
 *
 * Rows it creates are prefixed `zz-k10-` and deleted at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test cron-queue
 */
import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import {
  notebookExecutionService,
  TooManyRunsError,
} from "../src/services/notebook-execution.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { makeCheck, watchdog, cleanupNotebooks, store, finishedRun } from "./k10-helpers.js";

const wd = watchdog(150_000);
const { check, tally } = makeCheck();

await initDb();
await cleanupNotebooks();

const slowId = await store({
  name: "zz-k10-gate-filler",
  steps: [
    { id: "f1", kind: "cell", code: "await new Promise((r) => setTimeout(r, 1200)); return {};" },
  ],
});
const targetId = await store({
  name: "zz-k10-cron-target",
  outputs: ["ran"],
  steps: [{ id: "t1", kind: "cell", code: "return { ran: true };" }],
});
await notebooksService.deploy(targetId, "test");

console.log("\ncron under a full gate");

await check("with the gate full, a webhook is refused and a cron waits, then runs", async () => {
  // 4 running + 20 queued is the whole gate; the next webhook has nowhere to go.
  const fillers: Promise<unknown>[] = [];
  let refusedAt = -1;
  for (let i = 0; i < 40; i += 1) {
    try {
      const started = await notebookExecutionService.start(slowId, () => {}, { triggerSource: "manual" });
      fillers.push(started.completed);
    } catch (err) {
      assert.ok(err instanceof TooManyRunsError);
      refusedAt = i;
      break;
    }
  }
  assert.ok(refusedAt > 0, "the gate never filled");

  await assert.rejects(
    () => notebookExecutionService.start(targetId, () => {}, { triggerSource: "webhook" }),
    TooManyRunsError
  );

  const cron = await notebookExecutionService.start(targetId, () => {}, { triggerSource: "cron" });
  const waiting = await finishedRun(cron.runId, 100); // still queued behind the fillers
  assert.equal(waiting, undefined, "the cron run did not wait its turn");

  const result = await Promise.race([
    cron.completed,
    new Promise<null>((r) => setTimeout(() => r(null), 60_000)),
  ]);
  assert.ok(result, "the cron run never ran");
  assert.equal(result!.status, "success");
  assert.deepEqual(result!.outputs, { ran: true });
  await Promise.all(fillers);
});

await check("once the gate drains, a webhook is accepted again", async () => {
  const { completed } = await notebookExecutionService.start(targetId, () => {}, {
    triggerSource: "webhook",
  });
  assert.equal((await completed).status, "success");
});

await cleanupNotebooks();
clearTimeout(wd);
console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
await pool.end().catch(() => {});
process.exit(tally.failed === 0 ? 0 : 1);

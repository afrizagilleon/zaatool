/**
 * Nested `notebooks.run` calls are bounded per root run: at most MAX_NESTED_CONCURRENCY at
 * once (extra calls wait) and MAX_NESTED_CALLS in total (the next one rejects in the cell).
 * Before: a `Promise.all` of N calls spawned N workers at once.
 *
 * Rows it creates are prefixed `zz-k10-` and deleted at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test nested-fanout
 */
import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { makeCheck, watchdog, cleanupNotebooks, store } from "./k10-helpers.js";

const wd = watchdog(150_000);
const { check, tally } = makeCheck();

await initDb();
await cleanupNotebooks();

// The callee reports when it started and ended, so the caller can measure real overlap.
const calleeId = await store({
  name: "zz-k10-sleeper",
  outputs: ["start", "end"],
  steps: [
    {
      id: "c1",
      kind: "cell",
      code: "const start = Date.now(); await new Promise((r) => setTimeout(r, 300)); return { start, end: Date.now() };",
    },
  ],
});

/** Highest number of [start, end] intervals that overlap at any instant. */
const maxOverlap = `
  const events = [];
  for (const r of results) { events.push([r.start, 1]); events.push([r.end, -1]); }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, max = 0;
  for (const [, d] of events) { cur += d; if (cur > max) max = cur; }
`;

async function runCaller(name: string, code: string) {
  const id = await store({ name, outputs: ["max", "ok", "failed", "firstError"], steps: [{ id: "k1", kind: "cell", timeoutMs: 60_000, code }] });
  return notebookExecutionService.start(id, () => {}, { triggerSource: "manual" });
}

console.log("\nnested fan-out");

await check("20 parallel calls never run more than 4 at once", async () => {
  const { completed } = await runCaller(
    "zz-k10-fan20",
    `const results = await Promise.all(Array.from({ length: 20 }, () => notebooks.run(${JSON.stringify(calleeId)})));
     ${maxOverlap}
     return { max, ok: results.length };`
  );
  const result = await completed;
  assert.equal(result.status, "success", result.errors.join("; "));
  assert.equal(result.outputs.ok, 20);
  assert.ok(Number(result.outputs.max) <= 4, `max concurrent was ${result.outputs.max}`);
  assert.ok(Number(result.outputs.max) >= 2, `calls did not overlap at all (${result.outputs.max})`);
});

await check("with MAX_NESTED_CALLS=10 the 11th call rejects with a clear error", async () => {
  process.env.MAX_NESTED_CALLS = "10";
  try {
    const { completed } = await runCaller(
      "zz-k10-cap",
      `let ok = 0, failed = 0, firstError = "";
       for (let i = 0; i < 12; i++) {
         try { await notebooks.run(${JSON.stringify(calleeId)}); ok++; }
         catch (e) { failed++; if (!firstError) firstError = e.message; }
       }
       return { ok, failed, firstError };`
    );
    const result = await completed;
    assert.equal(result.status, "success", result.errors.join("; "));
    assert.equal(result.outputs.ok, 10);
    assert.equal(result.outputs.failed, 2);
    assert.match(String(result.outputs.firstError), /at most 10 nested notebook calls/);
  } finally {
    delete process.env.MAX_NESTED_CALLS;
  }
});

await check("a nested chain that fans out at every level does not deadlock on the 4 slots", async () => {
  const midId = await store({
    name: "zz-k10-mid",
    outputs: ["n"],
    steps: [
      {
        id: "m1",
        kind: "cell",
        timeoutMs: 60_000,
        code: `await Promise.all([1, 2].map(() => notebooks.run(${JSON.stringify(calleeId)}))); return { n: 1 };`,
      },
    ],
  });
  const { completed } = await runCaller(
    "zz-k10-fanmid",
    `const r = await Promise.all(Array.from({ length: 8 }, () => notebooks.run(${JSON.stringify(midId)}))); return { ok: r.length };`
  );
  const result = await Promise.race([
    completed,
    new Promise<null>((r) => setTimeout(() => r(null), 40_000)),
  ]);
  assert.ok(result, "the run deadlocked");
  assert.equal(result!.status, "success", result!.errors.join("; "));
  assert.equal(result!.outputs.ok, 8);
});

await cleanupNotebooks();
clearTimeout(wd);
console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
await pool.end().catch(() => {});
process.exit(tally.failed === 0 ? 0 : 1);

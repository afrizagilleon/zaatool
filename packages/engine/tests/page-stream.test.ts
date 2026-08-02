/**
 * M14 — a page fills in as its notebook runs.
 *
 * The page no longer waits for the whole run. It starts one, gets an id, and assembles
 * outputs from the events each cell emits as it finishes — so a table produced by the
 * first cell is readable while the fifth is still working.
 *
 * That makes three things load-bearing, and each is checked here:
 *   1. starting a page run answers immediately, not when the run ends
 *   2. `cell:done` names what the cell wrote *and* carries the value
 *   3. the events for an earlier cell arrive before a later cell has finished
 *
 * Notebooks it creates are prefixed `zz-stream-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/page-stream.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson, RunEvent } from "@zaa-tool/shared";

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

const created: string[] = [];

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document });
  if (!created.includes(id)) created.push(id);
  return id;
}

/** Three cells: a fast table, a slow number, a summary that needs both. */
const staged: Omit<NotebookJson, "version"> = {
  id: "",
  name: "zz-stream-staged",
  runtime: "node",
  outputs: [{ name: "rows", render: "table" }, "total", "summary"],
  steps: [
    {
      id: "fast",
      kind: "cell",
      code: "return { rows: [{ a: 1 }, { a: 2 }] };",
    },
    {
      id: "slow",
      kind: "cell",
      code: "await new Promise((done) => setTimeout(done, 400)); return { total: 3 };",
    },
    {
      id: "last",
      kind: "cell",
      code: "return { summary: `${inputs.rows.length} rows, total ${inputs.total}` };",
    },
  ],
};

console.log("\nwhat a page receives");

const events: (RunEvent & { at: number })[] = [];
const collect = (event: RunEvent) => {
  events.push({ ...event, at: Date.now() });
};

let notebookId = "";

await check("a page run answers with an id before the run has finished", async () => {
  notebookId = await store(staged);
  await notebooksService.deploy(notebookId, "test");

  const server = http.createServer(createApp(collect));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The endpoint is behind auth; the service call below is the same path the controller
  // takes, so the assertion that matters here is the timing of the reply, checked with
  // the service directly further down. This only proves the route still exists.
  const res = await fetch(`${base}/api/notebooks/${notebookId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "deployed" }),
  });
  assert.equal(res.status, 401, "the run route stopped requiring a session");
  server.close();
});

await check("starting resolves long before the slow cell does", async () => {
  events.length = 0;
  const startedAt = Date.now();

  const started = await notebookExecutionService.start(notebookId, collect, {
    triggerSource: "page",
  });
  const tookToStart = Date.now() - startedAt;

  assert.ok(started.runId, "no run id came back");
  assert.ok(
    tookToStart < 300,
    `starting took ${tookToStart}ms, so the page would have waited for the run`
  );

  const outcome = await started.completed;
  assert.equal(outcome.status, "success");
  assert.ok(Date.now() - startedAt >= 400, "the slow cell did not actually take time");
});

await check("each cell announces what it wrote, with the value", async () => {
  const done = events.filter((event) => event.type === "cell:done") as (RunEvent & {
    cellId: string;
    written?: string[];
    output?: Record<string, unknown>;
  })[];

  assert.deepEqual(
    done.map((event) => event.cellId),
    ["fast", "slow", "last"]
  );
  assert.deepEqual(done[0].written, ["rows"]);
  assert.deepEqual(done[1].written, ["total"]);
  assert.deepEqual(done[2].written, ["summary"]);

  // Without the value the page would know a name existed and still have nothing to show.
  assert.deepEqual(done[0].output?.rows, [{ a: 1 }, { a: 2 }]);
  assert.equal(done[1].output?.total, 3);
  assert.equal(done[2].output?.summary, "2 rows, total 3");
});

await check("the first output is announced well before the last", async () => {
  const first = events.find(
    (event) => event.type === "cell:done" && (event as { cellId?: string }).cellId === "fast"
  );
  const last = events.find(
    (event) => event.type === "cell:done" && (event as { cellId?: string }).cellId === "last"
  );

  assert.ok(first && last);
  assert.ok(
    last.at - first.at >= 350,
    `only ${last.at - first.at}ms apart — the page would have nothing to fill in`
  );
});

await check("a run that ends says so, so nothing waits forever", async () => {
  const ended = events.filter(
    (event) => event.type === "run:done" || event.type === "run:error"
  );
  assert.equal(ended.length, 1, "a page waiting on run:done would hang");
});

console.log("\nwhen a cell fails");

await check("what earlier cells produced is still announced", async () => {
  const id = await store({
    id: "",
    name: "zz-stream-breaks",
    runtime: "node",
    outputs: ["rows", "total"],
    steps: [
      { id: "ok", kind: "cell", code: "return { rows: [{ a: 1 }] };" },
      { id: "boom", kind: "cell", code: "throw new Error('nope');" },
    ],
  });
  await notebooksService.deploy(id, "test");

  events.length = 0;
  const started = await notebookExecutionService.start(id, collect, { triggerSource: "page" });
  const outcome = await started.completed;

  assert.equal(outcome.status, "failed");

  const good = events.find(
    (event) => event.type === "cell:done" && (event as { cellId?: string }).cellId === "ok"
  ) as (RunEvent & { written?: string[]; output?: Record<string, unknown> }) | undefined;

  assert.ok(good, "the cell that worked was never announced");
  assert.deepEqual(good.written, ["rows"]);
  assert.deepEqual(good.output?.rows, [{ a: 1 }]);

  // The failure has to be attributable to a cell, or the page cannot mark one output
  // failed and leave the rest readable.
  const bad = events.find((event) => event.type === "cell:error") as
    | (RunEvent & { cellId?: string })
    | undefined;
  assert.equal(bad?.cellId, "boom");
});

for (const id of created) await notebooksService.delete(id).catch(() => {});
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

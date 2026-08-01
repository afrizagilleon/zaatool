/**
 * M5b end to end, through the service and the real database.
 *
 * The unit suite proves the RPC bridge with a stub caller; this proves the half the
 * stub stands in for — resolving a notebook by name, its own secrets, the cycle guard,
 * and outputs coming back across two stored documents.
 *
 * Notebooks it creates are prefixed `zz-test-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-reuse-integration.test.ts
 */
import assert from "node:assert/strict";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson } from "@zaa-tool/shared";

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

const created: string[] = [];

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document });
  created.push(id);
  return id;
}

/**
 * Starts a run and waits for it to finish, collecting what a client would see.
 * The service is fire-and-forget by design, so the terminal event is the signal.
 */
function runToCompletion(
  notebookId: string,
  options: Parameters<typeof notebookExecutionService.start>[2] = {}
): Promise<{ status: string; error?: string; cells: Record<string, unknown>; logs: string[] }> {
  return new Promise((resolve, reject) => {
    const cells: Record<string, unknown> = {};
    const logs: string[] = [];
    /**
     * A called notebook publishes under its own run id through the same sink, so this
     * stands in for the event hub, which routes by run id. Without the filter a callee's
     * `run:done` would end the wait before the caller had finished.
     */
    let ownRunId: string | null = null;

    const timeout = setTimeout(() => reject(new Error("run did not finish in 60s")), 60_000);

    void notebookExecutionService
      .start(
        notebookId,
        (event: any) => {
          if (ownRunId !== null && event.runId !== ownRunId) return;
          if (event.type === "cell:done") cells[event.cellId] = event.output;
          if (event.type === "cell:log") logs.push(String(event.payload));
          if (event.type === "run:done") {
            clearTimeout(timeout);
            resolve({ status: "success", cells, logs });
          }
          if (event.type === "run:error") {
            clearTimeout(timeout);
            resolve({ status: "failed", error: String(event.error), cells, logs });
          }
        },
        options
      )
      .then(({ runId }) => {
        ownRunId = runId;
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

console.log("\nreuse, through the service");

const adderId = await store({
  id: "",
  name: "zz-test-adder",
  runtime: "node",
  inputs: [
    { name: "a", type: "number", required: true },
    { name: "b", type: "number", required: true },
  ],
  outputs: ["sum"],
  steps: [
    {
      id: "adder-cell",
      kind: "cell",
      code: "console.log('adding'); return { sum: inputs.a + inputs.b, workings: 'private' };",
    },
  ],
});

await check("a caller gets the declared output and nothing else", async () => {
  const callerId = await store({
    id: "",
    name: "zz-test-caller",
    runtime: "node",
    outputs: ["total", "leaked"],
    steps: [
      {
        id: "caller-cell",
        kind: "cell",
        code: `const r = await notebooks.run('zz-test-adder', { a: 2, b: 40 });
               return { total: r.sum, leaked: r.workings ?? null };`,
      },
    ],
  });

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "success", result.error);
  assert.deepEqual(result.cells["caller-cell"], { total: 42, leaked: null });
});

await check("the callee's logs surface in the calling cell, labelled", async () => {
  const callerId = await store({
    id: "",
    name: "zz-test-log-caller",
    runtime: "node",
    steps: [
      {
        id: "log-cell",
        kind: "cell",
        code: `await notebooks.run('zz-test-adder', { a: 1, b: 1 }); return {};`,
      },
    ],
  });

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "success", result.error);
  assert.ok(
    result.logs.some((line) => line === "[zz-test-adder] adding"),
    `logs were ${JSON.stringify(result.logs)}`
  );
});

await check("a notebook can be called by id as well as by name", async () => {
  const callerId = await store({
    id: "",
    name: "zz-test-by-id",
    runtime: "node",
    outputs: ["total"],
    steps: [
      {
        id: "by-id-cell",
        kind: "cell",
        code: `const r = await notebooks.run(${JSON.stringify(adderId)}, { a: 20, b: 22 });
               return { total: r.sum };`,
      },
    ],
  });

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "success", result.error);
  assert.deepEqual(result.cells["by-id-cell"], { total: 42 });
});

await check("string arguments coerce to a declared number", async () => {
  const callerId = await store({
    id: "",
    name: "zz-test-coerce",
    runtime: "node",
    outputs: ["total"],
    steps: [
      {
        id: "coerce-cell",
        kind: "cell",
        code: `const r = await notebooks.run('zz-test-adder', { a: '2', b: '40' });
               return { total: r.sum };`,
      },
    ],
  });

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "success", result.error);
  assert.deepEqual(result.cells["coerce-cell"], { total: 42 });
});

await check("a bad argument fails the call with the callee named", async () => {
  const callerId = await store({
    id: "",
    name: "zz-test-badarg",
    runtime: "node",
    outputs: ["message"],
    steps: [
      {
        id: "badarg-cell",
        kind: "cell",
        code: `try { await notebooks.run('zz-test-adder', { a: 1 }); return { message: null }; }
               catch (err) { return { message: err.message }; }`,
      },
    ],
  });

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "success", result.error);
  assert.match(String((result.cells["badarg-cell"] as any).message), /"b" is required/);
});

await check("a self-call is refused as a cycle", async () => {
  const selfId = await store({
    id: "",
    name: "zz-test-self",
    runtime: "node",
    outputs: ["message"],
    steps: [
      {
        id: "self-cell",
        kind: "cell",
        code: `try { await notebooks.run('zz-test-self'); return { message: null }; }
               catch (err) { return { message: err.message }; }`,
      },
    ],
  });

  const result = await runToCompletion(selfId);
  assert.equal(result.status, "success", result.error);
  assert.match(String((result.cells["self-cell"] as any).message), /cycle/);
});

await check("calling a notebook that does not exist says so", async () => {
  const callerId = await store({
    id: "",
    name: "zz-test-missing",
    runtime: "node",
    outputs: ["message"],
    steps: [
      {
        id: "missing-cell",
        kind: "cell",
        code: `try { await notebooks.run('zz-test-nope'); return { message: null }; }
               catch (err) { return { message: err.message }; }`,
      },
    ],
  });

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "success", result.error);
  assert.match(String((result.cells["missing-cell"] as any).message), /not found/);
});

await check("Python calls a JavaScript notebook", async () => {
  const callerId = await store({
    id: "",
    name: "zz-test-python-caller",
    runtime: "python",
    outputs: ["total"],
    steps: [
      {
        id: "py-cell",
        kind: "cell",
        code: `r = notebooks.run('zz-test-adder', {"a": 2, "b": 40})\nreturn {"total": r["sum"]}`,
      },
    ],
  });

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "success", result.error);
  assert.deepEqual(result.cells["py-cell"], { total: 42 });
});

await check("a run started with args binds them to the contract", async () => {
  const result = await runToCompletion(adderId, { args: { a: "1", b: 41 } });
  assert.equal(result.status, "success", result.error);
  assert.deepEqual(result.cells["adder-cell"], { sum: 42, workings: "private" });
});

await check("a run started without required args is refused before it starts", async () => {
  await assert.rejects(
    () => runToCompletion(adderId, { args: {} }),
    (err: unknown) => /"a" is required/.test((err as Error).message)
  );
});

await check("nested calls do not exhaust the run gate", async () => {
  // Five callers at once, each waiting on a callee: with the gate charging nested
  // runs too, four would fill it and every one of them would wait on itself.
  const callers = await Promise.all(
    [1, 2, 3, 4, 5].map((index) =>
      store({
        id: "",
        name: `zz-test-parallel-${index}`,
        runtime: "node",
        outputs: ["total"],
        steps: [
          {
            id: `parallel-cell-${index}`,
            kind: "cell",
            code: `const r = await notebooks.run('zz-test-adder', { a: ${index}, b: 1 });
                   return { total: r.sum };`,
          },
        ],
      })
    )
  );

  const results = await Promise.all(callers.map((id) => runToCompletion(id)));
  results.forEach((result, index) => {
    assert.equal(result.status, "success", result.error);
    assert.deepEqual(result.cells[`parallel-cell-${index + 1}`], { total: index + 2 });
  });
});

// ── a callee is a run of its own ──────────────────────────────────────────────

await check("a called notebook records its own run, linked to the caller's", async () => {
  const calleeId = await store({
    id: "",
    name: "zz-test-callee-history",
    runtime: "node",
    outputs: ["doubled"],
    steps: [{ id: "callee-cell", kind: "cell", code: "return { doubled: inputs.n * 2 };" }],
    inputs: [{ name: "n", type: "number", required: true }],
  });

  const callerId = await store({
    id: "",
    name: "zz-test-caller-history",
    runtime: "node",
    steps: [
      {
        id: "caller-cell",
        kind: "cell",
        code: "const r = await notebooks.run('zz-test-callee-history', { n: 21 }); return { total: r.doubled };",
      },
    ],
  });

  const before = await notebookRunsService.listByNotebook(calleeId);
  assert.equal(before.length, 0, "the callee already had runs");

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "success", result.error);

  const after = await notebookRunsService.listByNotebook(calleeId);
  assert.equal(after.length, 1, "the callee's run was not recorded");
  assert.equal(after[0].status, "success");
  assert.equal(after[0].trigger_source, "call");

  const callerRuns = await notebookRunsService.listByNotebook(callerId);
  assert.equal(after[0].parent_run_id, callerRuns[0].id, "the callee is not linked to its caller");

  const detail = await notebookRunsService.getById(after[0].id);
  assert.deepEqual(detail?.cell_results["callee-cell"]?.output, { doubled: 42 });
  assert.ok(
    detail?.cell_results["callee-cell"]?.source?.includes("inputs.n"),
    "the callee's own source was not recorded"
  );
});

await check("a callee that fails leaves its own failed run behind", async () => {
  const calleeId = await store({
    id: "",
    name: "zz-test-callee-fails",
    runtime: "node",
    steps: [{ id: "boom", kind: "cell", code: "throw new Error('callee exploded');" }],
  });

  const callerId = await store({
    id: "",
    name: "zz-test-caller-of-failure",
    runtime: "node",
    steps: [
      { id: "caller-cell-2", kind: "cell", code: "await notebooks.run('zz-test-callee-fails'); return {};" },
    ],
  });

  const result = await runToCompletion(callerId);
  assert.equal(result.status, "failed");

  const runs = await notebookRunsService.listByNotebook(calleeId);
  assert.equal(runs.length, 1, "a failing callee left no record");
  assert.equal(runs[0].status, "failed");

  const detail = await notebookRunsService.getById(runs[0].id);
  assert.match(String(detail?.cell_results["boom"]?.error), /callee exploded/);
});

for (const id of created) {
  await notebooksService.delete(id).catch(() => {});
}
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

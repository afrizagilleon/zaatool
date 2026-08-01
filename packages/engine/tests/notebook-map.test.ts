/**
 * M7.1 — the map is derived, so it cannot be wrong.
 *
 * What is being checked is that reading the code finds every call and admits the ones
 * it cannot resolve. A map that quietly omits an edge is worse than no map: it would be
 * believed.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-map.test.ts
 */
import assert from "node:assert/strict";
import { buildNotebookMap, renderNotebookMap } from "../src/core/notebook-map.js";
import type { NotebookJson } from "@zaa-tool/shared";

let passed = 0;
let failed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n").join("\n       ")}`);
  }
}

const doc = (over: Partial<NotebookJson>): { document: NotebookJson; updatedAt: string } => ({
  document: { version: "1.0", id: "nb", name: "Test", runtime: "node", steps: [], ...over },
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const cell = (id: string, code: string) => ({ id, kind: "cell" as const, code });

console.log("\nshape");

check("a notebook's contract, triggers and cell count are on the map", () => {
  const map = buildNotebookMap([
    doc({
      id: "a",
      name: "invoice",
      inputs: [
        { name: "id", type: "string", required: true },
        { name: "retries", type: "number" },
      ],
      outputs: ["total"],
      secrets: ["XENDIT_KEY"],
      triggers: [
        { id: "t1", kind: "cron", cron: "0 9 * * *" },
        { id: "t2", kind: "webhook", slug: "s-1", enabled: false },
      ],
      steps: [cell("c1", "return {};"), cell("c2", "return {};")],
    }),
  ]);

  const [notebook] = map.notebooks;
  assert.deepEqual(notebook.inputs, ["id: string!", "retries: number"]);
  assert.deepEqual(notebook.outputs, ["total"]);
  assert.deepEqual(notebook.secrets, ["XENDIT_KEY"]);
  assert.equal(notebook.cellCount, 2);

  assert.deepEqual(
    map.triggers.map((trigger) => [trigger.kind, trigger.label, trigger.enabled]),
    [
      ["cron", "0 9 * * *", true],
      ["webhook", "/hooks/s-1", false],
    ]
  );
});

check("cells inside lanes are counted, and the parallel group is noted", () => {
  const map = buildNotebookMap([
    doc({
      steps: [
        cell("c0", "return {};"),
        {
          id: "p1",
          kind: "parallel",
          lanes: [
            { id: "l1", steps: [cell("c1", "return {};")] },
            { id: "l2", steps: [cell("c2", "return {};"), cell("c3", "return {};")] },
          ],
        },
      ],
    }),
  ]);

  assert.equal(map.notebooks[0].cellCount, 4);
  assert.equal(map.notebooks[0].parallelCount, 1);
});

check("a note-only cell is not a step on the map", () => {
  const map = buildNotebookMap([
    doc({ steps: [{ id: "c1", kind: "cell", note: "just an explanation" }] }),
  ]);
  assert.equal(map.notebooks[0].cellCount, 0);
});

console.log("\ncalls");

check("a call by name becomes an edge", () => {
  const map = buildNotebookMap([
    doc({ id: "a", name: "caller", steps: [cell("c1", "const r = await notebooks.run('adder', { a: 1 });")] }),
    doc({ id: "b", name: "adder" }),
  ]);

  assert.equal(map.calls.length, 1);
  assert.deepEqual(
    { from: map.calls[0].fromNotebookId, to: map.calls[0].toNotebookId, resolved: map.calls[0].resolved },
    { from: "a", to: "b", resolved: true }
  );
});

check("a call by id resolves the same way the engine would", () => {
  const map = buildNotebookMap([
    doc({ id: "a", name: "caller", steps: [cell("c1", 'await notebooks.run("b");')] }),
    doc({ id: "b", name: "adder" }),
  ]);
  assert.equal(map.calls[0].toNotebookId, "b");
});

check("several calls in one cell are several edges", () => {
  const map = buildNotebookMap([
    doc({
      id: "a",
      name: "caller",
      steps: [cell("c1", "await notebooks.run('one'); await notebooks.run('two');")],
    }),
    doc({ id: "b", name: "one" }),
    doc({ id: "c", name: "two" }),
  ]);
  assert.equal(map.calls.length, 2);
  assert.deepEqual(map.calls.map((call) => call.toNotebookId).sort(), ["b", "c"]);
});

check("a call to something that is not there is shown, not dropped", () => {
  const map = buildNotebookMap([
    doc({ id: "a", name: "caller", steps: [cell("c1", "await notebooks.run('ghost');")] }),
  ]);
  assert.equal(map.calls.length, 1);
  assert.equal(map.calls[0].resolved, false);
  assert.equal(map.calls[0].reference, "ghost");
});

check("an ambiguous name is reported as ambiguous rather than guessed", () => {
  const map = buildNotebookMap([
    doc({ id: "a", name: "caller", steps: [cell("c1", "await notebooks.run('twin');")] }),
    doc({ id: "b", name: "twin" }),
    doc({ id: "c", name: "twin" }),
  ]);
  assert.equal(map.calls[0].ambiguous, true);
  assert.equal(map.calls[0].toNotebookId, null);
});

check("a computed target is admitted as computed", () => {
  const map = buildNotebookMap([
    doc({ id: "a", name: "caller", steps: [cell("c1", "await notebooks.run(inputs.which);")] }),
  ]);
  assert.equal(map.calls.length, 1);
  assert.equal(map.calls[0].dynamic, true);
  assert.equal(map.calls[0].reference, "(computed)");
});

check("literal and computed calls in one cell are both counted", () => {
  const map = buildNotebookMap([
    doc({
      id: "a",
      name: "caller",
      steps: [cell("c1", "await notebooks.run('one'); await notebooks.run(name);")],
    }),
    doc({ id: "b", name: "one" }),
  ]);
  assert.equal(map.calls.length, 2);
  assert.equal(map.calls.filter((call) => call.dynamic).length, 1);
});

check("a call from inside a lane keeps the cell it came from", () => {
  const map = buildNotebookMap([
    doc({
      id: "a",
      name: "caller",
      steps: [
        {
          id: "p1",
          kind: "parallel",
          lanes: [{ id: "l1", steps: [cell("deep", "await notebooks.run('one');")] }],
        },
      ],
    }),
    doc({ id: "b", name: "one" }),
  ]);
  assert.equal(map.calls[0].fromCellId, "deep");
});

check("whitespace between the words does not hide a call", () => {
  const map = buildNotebookMap([
    doc({ id: "a", name: "caller", steps: [cell("c1", "await notebooks . run (\n  'one'\n);")] }),
    doc({ id: "b", name: "one" }),
  ]);
  assert.equal(map.calls[0].toNotebookId, "b");
});

console.log("\nas text");

check("the written map names who calls whom, in both directions", () => {
  const text = renderNotebookMap(
    buildNotebookMap([
      doc({
        id: "a",
        name: "caller",
        triggers: [{ id: "t1", kind: "cron", cron: "0 9 * * *" }],
        steps: [cell("c1", "await notebooks.run('adder');")],
      }),
      doc({ id: "b", name: "adder", outputs: ["sum"] }),
    ])
  );

  assert.match(text, /calls adder/);
  assert.match(text, /called by caller/);
  assert.match(text, /cron 0 9 \* \* \*/);
});

check("an empty workspace says so instead of rendering nothing", () => {
  assert.match(renderNotebookMap(buildNotebookMap([])), /No notebooks yet/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

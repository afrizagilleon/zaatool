/**
 * M12 — an output that knows its shape.
 *
 * The rule under test is that `render` is an override and never a requirement: a
 * document written before it existed still reads, still runs, and still round-trips
 * unchanged. What the runner receives must be names and nothing else — how a value
 * looks is no concern of the thing computing it.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-render.test.ts
 */
import assert from "node:assert/strict";
import { outputNames, outputSpecs } from "../src/core/notebook-outputs.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import { selectOutputs } from "../src/core/notebook-contract.js";
import { toMarkdown, fromMarkdown, NotebookTextError } from "../src/core/notebook-text.js";
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

const doc = (outputs: NotebookJson["outputs"]): NotebookJson => ({
  version: "1.0",
  id: "nb-render",
  name: "Render",
  runtime: "node",
  outputs,
  steps: [{ id: "c1", kind: "cell", code: "return { rows: [], total: 1 };" }],
});

// ── both forms mean the same thing ────────────────────────────────────────────

console.log("\nreading outputs");

check("a bare name and a mapping produce the same name", () => {
  assert.deepEqual(outputNames(["total"]), ["total"]);
  assert.deepEqual(outputNames([{ name: "total", render: "chart" }]), ["total"]);
});

check("the two forms mix in one list", () => {
  assert.deepEqual(outputNames(["rows", { name: "total", render: "text" }]), ["rows", "total"]);
});

check("specs keep what was declared and fill in nothing", () => {
  assert.deepEqual(outputSpecs(["rows", { name: "total", render: "chart", x: "month" }]), [
    { name: "rows" },
    { name: "total", render: "chart", x: "month" },
  ]);
});

check("a repeated name is asked for once", () => {
  assert.deepEqual(outputNames(["a", { name: "a", render: "table" }, "b"]), ["a", "b"]);
});

check("nameless entries are dropped rather than producing an empty column", () => {
  assert.deepEqual(outputNames(["", { name: "  " }, "real"]), ["real"]);
});

// ── the runner never learns about presentation ────────────────────────────────

console.log("\nwhat the runner gets");

check("the compiled plan carries names only", () => {
  const plan = compileNotebook(doc([{ name: "rows", render: "table" }, "total"]));
  assert.deepEqual(plan.outputs, ["rows", "total"]);
});

check("a nameless output is a compile issue, not a silent gap", () => {
  assert.throws(() => compileNotebook(doc([{ name: "" } as never])));
});

check("selecting outputs is unchanged by render", () => {
  const plan = compileNotebook(doc([{ name: "rows", render: "chart" }, "total"]));
  assert.deepEqual(selectOutputs(plan.outputs, { rows: [1], total: 7, other: "x" }), {
    rows: [1],
    total: 7,
  });
});

// ── documents written before this still read ──────────────────────────────────

console.log("\ntext form");

check("a list of bare names round-trips as bare names", () => {
  const back = fromMarkdown(toMarkdown(doc(["rows", "total"])));
  assert.deepEqual(back.outputs, ["rows", "total"]);
});

check("render round-trips", () => {
  const back = fromMarkdown(toMarkdown(doc([{ name: "rows", render: "chart", x: "month" }])));
  assert.deepEqual(back.outputs, [{ name: "rows", render: "chart", x: "month" }]);
});

check("`auto` is not written down, because it says nothing", () => {
  const back = fromMarkdown(toMarkdown(doc([{ name: "rows", render: "auto" }])));
  assert.deepEqual(back.outputs, [{ name: "rows" }]);
});

check("an unknown render is refused rather than quietly ignored", () => {
  const text = [
    "---",
    "name: Render",
    "runtime: node",
    "outputs:",
    "  - name: rows",
    "    render: pivot",
    "---",
    "",
    "```js",
    "return {};",
    "```",
  ].join("\n");

  assert.throws(
    () => fromMarkdown(text),
    (err: unknown) =>
      err instanceof NotebookTextError && err.issues.some((issue) => issue.includes("pivot"))
  );
});

check("an output mapping with no name is refused", () => {
  const text = [
    "---",
    "name: Render",
    "runtime: node",
    "outputs:",
    "  - render: table",
    "---",
    "",
    "```js",
    "return {};",
    "```",
  ].join("\n");

  assert.throws(() => fromMarkdown(text), NotebookTextError);
});

check("a description on an output survives", () => {
  const back = fromMarkdown(
    toMarkdown(doc([{ name: "total", description: "What it all came to" }]))
  );
  assert.deepEqual(back.outputs, [{ name: "total", description: "What it all came to" }]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

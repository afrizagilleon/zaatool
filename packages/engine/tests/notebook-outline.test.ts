/**
 * M20 — changing part of a notebook instead of all of it.
 *
 * The measured problem: reading a notebook costs about 214 tokens per cell, so adding one
 * line to a twenty-cell notebook meant ~8,600 tokens of read-and-rewrite. The token count
 * was never the worst of it. A model rewriting nineteen cells from memory does not
 * reproduce them exactly, and `layout` and `actions` vanished that way often enough to
 * need their own fix in M17.
 *
 * So two claims are under test. That the outline tells you which cell to touch without
 * showing you any code, and that editing one cell leaves every other cell alone — and is
 * refused when it would break the chain of names cells pass between themselves.
 *
 *   pnpm --filter @zaa-tool/engine test notebook-outline
 */
import assert from "node:assert/strict";
import { cellReads, cellWrites, outlineOf, renderOutline, brokenReads } from "../src/core/notebook-outline.js";
import { applyCellEdit, CellEditError } from "../src/core/notebook-edit.js";
import { fromMarkdown, toMarkdown } from "../src/core/notebook-text.js";
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

const CHAIN: NotebookJson = fromMarkdown(
  [
    "---",
    "name: zz-outline-chain",
    "id: zz-outline-chain-id",
    "runtime: node",
    "inputs:",
    "  - name: pair",
    "    type: string",
    "outputs: [summary]",
    "---",
    "",
    "<!-- zaa:cell -->",
    "Fetch the rows.",
    "<!-- zaa:code -->",
    "```js",
    "return { rows: [{ a: 1 }], fetchedAt: Date.now() };",
    "```",
    "",
    "<!-- zaa:cell -->",
    "Count them.",
    "<!-- zaa:code -->",
    "```js",
    "return { total: inputs.rows.length };",
    "```",
    "",
    "<!-- zaa:cell -->",
    "Say it.",
    "<!-- zaa:code -->",
    "```js",
    'return { summary: `${inputs.pair}: ${inputs.total}` };',
    "```",
  ].join("\n")
);

const cellIds = outlineOf(CHAIN).map((cell) => cell.cellId);

// ── reading a cell without running it ─────────────────────────────────────────

console.log("\nwhat a cell reads and writes");

check("both forms of reading the scope are seen", () => {
  assert.deepEqual(cellReads('inputs.rows; inputs["total"]; inputs .pair'), [
    "rows",
    "pair",
    "total",
  ]);
});

check("a returned object literal is read, shorthand included", () => {
  const written = cellWrites("const a = 1; return { a, total: 2, 'quoted': 3 };");
  assert.deepEqual(written.names.sort(), ["a", "quoted", "total"]);
  assert.equal(written.known, true);
});

check("a nested object does not contribute phantom names", () => {
  const written = cellWrites("return { report: { hidden: 1, alsoHidden: 2 }, total: 3 };");
  assert.deepEqual(written.names.sort(), ["report", "total"]);
});

check("a brace inside a string is not read as structure", () => {
  const written = cellWrites('return { note: "a { b } c", total: 1 };');
  assert.deepEqual(written.names.sort(), ["note", "total"]);
});

check("a spread says it does not know, rather than saying nothing", () => {
  const written = cellWrites("return { ...previous, total: 1 };");
  assert.equal(written.known, false);
  assert.ok(written.names.includes("total"));
});

check("a cell with no literal return is unknown, not empty", () => {
  assert.equal(cellWrites("return buildResult();").known, false);
});

// ── the outline ───────────────────────────────────────────────────────────────

console.log("\nthe outline");

check("one entry per cell, in the order they run", () => {
  const outline = outlineOf(CHAIN);
  assert.equal(outline.length, 3);
  assert.deepEqual(outline[0].writes.sort(), ["fetchedAt", "rows"]);
  assert.deepEqual(outline[1].reads, ["rows"]);
  assert.deepEqual(outline[2].reads.sort(), ["pair", "total"]);
});

check("the note's first line is the title, since a person wrote it", () => {
  assert.equal(outlineOf(CHAIN)[0].title, "Fetch the rows.");
});

check("it carries no code at all, which is the entire point", () => {
  const rendered = renderOutline(CHAIN);
  assert.ok(!rendered.includes("Date.now()"), "the outline leaked a cell's code");
  assert.ok(rendered.includes("reads:"));
  assert.ok(rendered.length < toMarkdown(CHAIN).length, "the outline is not smaller than the text");
});

check("a lane is named, because two lanes are not one sequence", () => {
  const parallel = fromMarkdown(
    [
      "---",
      "name: zz-outline-lanes",
      "id: zz-outline-lanes-id",
      "runtime: node",
      "---",
      "",
      "<!-- zaa:parallel -->",
      "<!-- zaa:lane label=left -->",
      "<!-- zaa:cell -->",
      "<!-- zaa:code -->",
      "```js",
      "return { left: 1 };",
      "```",
      "<!-- zaa:lane label=right -->",
      "<!-- zaa:cell -->",
      "<!-- zaa:code -->",
      "```js",
      "return { right: 2 };",
      "```",
      "<!-- zaa:end -->",
    ].join("\n")
  );

  const outline = outlineOf(parallel);
  assert.deepEqual(
    outline.map((cell) => cell.lane),
    ["left", "right"]
  );
});

// ── editing one cell ──────────────────────────────────────────────────────────

console.log("\nediting one cell");

check("replacing a cell leaves every other cell byte for byte", () => {
  const edited = applyCellEdit(CHAIN, {
    action: "replace",
    cell: cellIds[1],
    code: "return { total: inputs.rows.length * 2 };",
  });

  const before = CHAIN.steps as { id: string; code?: string; note?: string }[];
  const after = edited.steps as { id: string; code?: string; note?: string }[];

  assert.equal(after[0].code, before[0].code);
  assert.equal(after[2].code, before[2].code);
  assert.match(String(after[1].code), /\* 2/);
  // Not given, so not touched — changing a note must not blank the code, and the reverse.
  assert.equal(after[1].note, before[1].note);
});

check("inserting puts the new cell where it was asked for, with an id of its own", () => {
  const edited = applyCellEdit(CHAIN, {
    action: "insert_after",
    cell: cellIds[0],
    code: "return { checked: true };",
    note: "Check it.",
  });

  const ids = outlineOf(edited).map((cell) => cell.cellId);
  assert.equal(ids.length, 4);
  assert.equal(ids[0], cellIds[0]);
  assert.equal(ids[2], cellIds[1]);
  assert.ok(!cellIds.includes(ids[1]), "the new cell reused an existing id");
});

check("appending needs no cell id", () => {
  const edited = applyCellEdit(CHAIN, { action: "append", code: "return { extra: 1 };" });
  assert.equal(outlineOf(edited).length, 4);
});

check("naming a cell that is not there fails loudly", () => {
  assert.throws(
    () => applyCellEdit(CHAIN, { action: "delete", cell: "zz-not-a-cell" }),
    CellEditError
  );
});

// ── the refusal ───────────────────────────────────────────────────────────────

console.log("\nwhat an edit is not allowed to break");

check("deleting the cell that writes a name a later cell reads is refused", () => {
  assert.throws(
    () => applyCellEdit(CHAIN, { action: "delete", cell: cellIds[0] }),
    /rows/,
    "the chain was allowed to break"
  );
});

check("the refusal names the cell that would fail, not just the name", () => {
  try {
    applyCellEdit(CHAIN, { action: "delete", cell: cellIds[0] });
    assert.fail("it was allowed");
  } catch (err) {
    assert.match((err as Error).message, new RegExp(cellIds[1]));
  }
});

check("deleting the last cell is fine, because nothing reads it", () => {
  const edited = applyCellEdit(CHAIN, { action: "delete", cell: cellIds[2] });
  assert.equal(outlineOf(edited).length, 2);
});

check("a declared input counts as written, so reading `pair` is not a break", () => {
  assert.deepEqual(brokenReads(CHAIN), []);
});

check("a notebook that is already broken stays editable", () => {
  const broken = fromMarkdown(
    [
      "---",
      "name: zz-outline-broken",
      "id: zz-outline-broken-id",
      "runtime: node",
      "---",
      "",
      "<!-- zaa:cell -->",
      "<!-- zaa:code -->",
      "```js",
      "return { a: inputs.missing };",
      "```",
      "",
      "<!-- zaa:cell -->",
      "<!-- zaa:code -->",
      "```js",
      "return { b: 1 };",
      "```",
    ].join("\n")
  );

  assert.equal(brokenReads(broken).length, 1);
  // The existing break must not become a reason to refuse every repair.
  const edited = applyCellEdit(broken, {
    action: "append",
    code: "return { c: 1 };",
  });
  assert.equal(outlineOf(edited).length, 3);
});

// ── the map ───────────────────────────────────────────────────────────────────

console.log("\nfinding what already exists");

const WORKSPACE = [
  fromMarkdown(
    [
      "---",
      "name: zz-outline-nightly",
      "id: zz-outline-nightly-id",
      "runtime: node",
      "triggers:",
      "  - kind: cron",
      "    cron: 0 3 * * *",
      "---",
      "",
      "```js",
      "await notebooks.run('zz-outline-rates');",
      "return {};",
      "```",
    ].join("\n")
  ),
  fromMarkdown(
    [
      "---",
      "name: zz-outline-rates",
      "id: zz-outline-rates-id",
      "runtime: node",
      "inputs:",
      "  - name: invoice",
      "    type: string",
      "outputs: [rate]",
      "---",
      "",
      "```js",
      "return { rate: 1 };",
      "```",
    ].join("\n")
  ),
  fromMarkdown(
    [
      "---",
      "name: zz-outline-draft",
      "id: zz-outline-draft-id",
      "runtime: node",
      "---",
      "",
      "```js",
      "return {};",
      "```",
    ].join("\n")
  ),
].map((document) => ({ document, updatedAt: new Date().toISOString() }));

check("the map sorts by how a notebook is reached, not by name", () => {
  const rendered = renderNotebookMap(buildNotebookMap(WORKSPACE), { grouped: true });

  const startsAt = rendered.indexOf("Starts on its own");
  const calledAt = rendered.indexOf("Called by others");
  const neitherAt = rendered.indexOf("Neither");

  assert.ok(startsAt !== -1 && calledAt !== -1 && neitherAt !== -1, rendered);
  assert.ok(startsAt < calledAt && calledAt < neitherAt, "the groups came out in the wrong order");
  // Its *entry* line, not any mention: the caller's block says "calls zz-outline-rates"
  // above, and matching that would pass whatever the grouping did.
  assert.ok(
    rendered.indexOf("- **zz-outline-rates**") > calledAt,
    "a reusable notebook is not grouped as one"
  );
});

check("`about` narrows it, and matches the contract as well as the name", () => {
  const rendered = renderNotebookMap(buildNotebookMap(WORKSPACE), { about: "invoice" });
  assert.ok(rendered.includes("zz-outline-rates"), rendered);
  assert.ok(!rendered.includes("zz-outline-draft"), "the filter kept something unrelated");
});

check("a word that matches nothing says so rather than returning everything", () => {
  const rendered = renderNotebookMap(buildNotebookMap(WORKSPACE), { about: "zzzz-nothing" });
  assert.match(rendered, /Nothing in this workspace mentions/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

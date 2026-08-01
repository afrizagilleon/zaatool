/**
 * M8.2 — who last changed each cell.
 *
 * The point is not blame, it is triage: when an agent writes forty cells you read the
 * ones that changed. So the two things worth proving are that it notices a real change
 * and ignores everything that only *looks* like one — and that it cannot be forged.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-provenance.test.ts
 */
import assert from "node:assert/strict";
import { stampAuthors } from "../src/core/notebook-provenance.js";
import type { NotebookCell, NotebookJson } from "@zaa-tool/shared";

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

const doc = (steps: NotebookJson["steps"]): NotebookJson => ({
  version: "1.0",
  id: "nb",
  name: "Test",
  runtime: "node",
  steps,
});

const cell = (id: string, over: Partial<NotebookCell> = {}): NotebookCell => ({
  id,
  kind: "cell",
  code: "return {};",
  ...over,
});

const authorOf = (notebook: NotebookJson, index = 0) =>
  (notebook.steps[index] as NotebookCell).author;

console.log("\nwhat counts as a change");

check("a new cell is credited to whoever wrote it", () => {
  const stamped = stampAuthors(null, doc([cell("a")]), "afriza", "2026-08-01T00:00:00.000Z");
  assert.deepEqual(authorOf(stamped), { by: "afriza", at: "2026-08-01T00:00:00.000Z" });
});

check("changed code is re-credited", () => {
  const before = stampAuthors(null, doc([cell("a")]), "afriza", "2026-08-01T00:00:00.000Z");
  const after = stampAuthors(
    before,
    doc([cell("a", { code: "return { changed: true };" })]),
    "claude code",
    "2026-08-02T00:00:00.000Z"
  );
  assert.deepEqual(authorOf(after), { by: "claude code", at: "2026-08-02T00:00:00.000Z" });
});

check("a changed note counts, because the note is the spec", () => {
  const before = stampAuthors(null, doc([cell("a")]), "afriza", "2026-08-01T00:00:00.000Z");
  const after = stampAuthors(before, doc([cell("a", { note: "why" })]), "hermes", "2026-08-02T00:00:00.000Z");
  assert.equal(authorOf(after)?.by, "hermes");
});

check("saving an untouched cell leaves its author alone", () => {
  const before = stampAuthors(null, doc([cell("a")]), "afriza", "2026-08-01T00:00:00.000Z");
  const after = stampAuthors(before, doc([cell("a")]), "claude code", "2026-08-02T00:00:00.000Z");
  assert.deepEqual(authorOf(after), { by: "afriza", at: "2026-08-01T00:00:00.000Z" });
});

check("moving a cell is not changing it", () => {
  const before = stampAuthors(
    null,
    doc([cell("a"), cell("b", { code: "return { b: 1 };" })]),
    "afriza",
    "2026-08-01T00:00:00.000Z"
  );
  const after = stampAuthors(
    before,
    doc([cell("b", { code: "return { b: 1 };" }), cell("a")]),
    "claude code",
    "2026-08-02T00:00:00.000Z"
  );
  assert.equal(authorOf(after, 0)?.by, "afriza");
  assert.equal(authorOf(after, 1)?.by, "afriza");
});

check("folding a cell is not changing it", () => {
  const before = stampAuthors(null, doc([cell("a")]), "afriza", "2026-08-01T00:00:00.000Z");
  const after = stampAuthors(
    before,
    doc([cell("a", { collapsed: { code: true } })]),
    "claude code",
    "2026-08-02T00:00:00.000Z"
  );
  assert.equal(authorOf(after)?.by, "afriza");
});

check("cells inside lanes are stamped too", () => {
  const stamped = stampAuthors(
    null,
    doc([
      {
        id: "p1",
        kind: "parallel",
        lanes: [{ id: "l1", steps: [cell("deep")] }],
      },
    ]),
    "hermes",
    "2026-08-01T00:00:00.000Z"
  );

  const lane = (stamped.steps[0] as { lanes: { steps: NotebookCell[] }[] }).lanes[0];
  assert.equal(lane.steps[0].author?.by, "hermes");
});

console.log("\nit cannot be claimed");

check("an author sent by the writer is overwritten, not trusted", () => {
  const forged = doc([cell("a", { author: { by: "afriza", at: "1999-01-01T00:00:00.000Z" } })]);
  const stamped = stampAuthors(null, forged, "claude code", "2026-08-01T00:00:00.000Z");
  assert.deepEqual(authorOf(stamped), { by: "claude code", at: "2026-08-01T00:00:00.000Z" });
});

check("an unchanged cell cannot have its author rewritten either", () => {
  const before = stampAuthors(null, doc([cell("a")]), "afriza", "2026-08-01T00:00:00.000Z");
  const forged = doc([cell("a", { author: { by: "someone else", at: "1999-01-01T00:00:00.000Z" } })]);
  const after = stampAuthors(before, forged, "claude code", "2026-08-02T00:00:00.000Z");
  assert.deepEqual(authorOf(after), { by: "afriza", at: "2026-08-01T00:00:00.000Z" });
});

check("a cell from before provenance existed stays unattributed", () => {
  const before = doc([cell("a")]);
  const after = stampAuthors(before, doc([cell("a")]), "claude code", "2026-08-02T00:00:00.000Z");
  assert.equal(authorOf(after), undefined, "it was credited to whoever happened to save next");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * M13 — what a run reports back to an agent.
 *
 * A run reply used to carry every output and every cell result verbatim. Ninety-three
 * rows cost tens of thousands of tokens of the agent's context every time the notebook
 * ran; a million rows ended the session. The information an agent needs to decide the
 * next step is the shape and the size, and that form keeps working at any size.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-abridge.test.ts
 */
import assert from "node:assert/strict";
import { abridge, wasAbridged } from "../src/mcp/abridge.js";

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

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    region: "Jakarta",
    revenue: 100_000 + index,
  }));

console.log("\nsize before contents");

check("a table becomes its size, its columns and three rows", () => {
  const short = abridge(rows(93)) as {
    summary: string;
    columns: string[];
    first: unknown[];
  };
  assert.equal(short.summary, "93 rows × 3 columns");
  assert.deepEqual(short.columns, ["id", "region", "revenue"]);
  assert.equal(short.first.length, 3);
});

check("the true count survives at a size that used to end the session", () => {
  const short = abridge(rows(1_204_882)) as { summary: string };
  assert.match(short.summary, /^1204882 rows/);
});

check("a small table is left exactly as it is", () => {
  const original = rows(3);
  assert.deepEqual(abridge(original), original);
  assert.equal(wasAbridged(original, abridge(original)), false);
});

check("a plain list keeps five and says how many", () => {
  const short = abridge(Array.from({ length: 40 }, (_, index) => index)) as {
    summary: string;
    first: number[];
  };
  assert.equal(short.summary, "40 items");
  assert.deepEqual(short.first, [0, 1, 2, 3, 4]);
});

check("an empty array stays an empty array, not a summary of nothing", () => {
  assert.deepEqual(abridge([]), []);
});

console.log("\nstrings and objects");

check("a long string is cut and says how much was cut", () => {
  const short = abridge("x".repeat(2_000)) as string;
  assert.ok(short.length < 1_000, `still ${short.length} characters`);
  assert.match(short, /\[\+1200 more characters\]$/);
});

check("a short string is untouched, so an error message stays readable", () => {
  assert.equal(abridge("Cannot read property 'x' of undefined"), "Cannot read property 'x' of undefined");
});

check("a record keeps its keys", () => {
  const meta = { source: "ledger", ok: true, count: 93 };
  assert.deepEqual(abridge(meta), meta);
});

check("a table nested inside a result is abridged too", () => {
  const short = abridge({ summary: { total: 5 }, rows: rows(50) }) as {
    summary: { total: number };
    rows: { summary: string };
  };
  assert.deepEqual(short.summary, { total: 5 });
  assert.equal(short.rows.summary, "50 rows × 3 columns");
});

check("null and numbers pass through", () => {
  assert.equal(abridge(null), null);
  assert.equal(abridge(42), 42);
  assert.equal(abridge(false), false);
});

check("deep nesting stops rather than recursing forever", () => {
  let deep: unknown = "bottom";
  for (let level = 0; level < 20; level += 1) deep = { next: deep };
  assert.doesNotThrow(() => JSON.stringify(abridge(deep)));
});

check("a cycle does not hang", () => {
  const looping: Record<string, unknown> = { name: "self" };
  looping.self = looping;
  assert.doesNotThrow(() => JSON.stringify(abridge(looping)));
});

console.log("\nwhat it costs");

check("a 93-row reply is an order of magnitude smaller", () => {
  const original = JSON.stringify({ rows: rows(93) }).length;
  const shortened = JSON.stringify({ rows: abridge(rows(93)) }).length;
  assert.ok(
    shortened * 8 < original,
    `only shrank from ${original} to ${shortened} characters`
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * L-06: the redactor that stands between a run's secrets and everything the run produces.
 * Pure functions, no database.
 *
 *   pnpm --filter @zaa-tool/engine test secret-redactor
 */
import assert from "node:assert/strict";
import { createRedactor, MIN_SECRET_LENGTH } from "../src/core/secret-redactor.js";
import { createRunEmitter } from "../src/core/run-emitter.js";
import type { RunEvent } from "@zaa-tool/shared";

let passed = 0;
let failed = 0;
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
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

const SECRET = 'sk-live/OWNER+only "99" é';
const redactor = createRedactor({ API_KEY: SECRET });
const MARK = "[secret:API_KEY]";

console.log("\nsecret-redactor: encodings");

await check("the raw value", () => {
  assert.equal(redactor.string(`key=${SECRET} done`), `key=${MARK} done`);
});

await check("JSON-escaped, as it appears inside a serialized object", () => {
  const serialized = JSON.stringify({ k: SECRET });
  assert.ok(serialized.includes('\\"99\\"'), "fixture should have an escape");
  assert.equal(redactor.string(serialized), `{"k":"${MARK}"}`);
});

await check("encodeURIComponent, upper and lower hex digits", () => {
  const uri = encodeURIComponent(SECRET);
  assert.equal(redactor.string(`?k=${uri}&x=1`), `?k=${MARK}&x=1`);
  assert.equal(redactor.string(`?k=${uri.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())}`), `?k=${MARK}`);
});

await check("form encoding, with + for a space", () => {
  const spaced = createRedactor({ S: "correct horse battery" });
  const form = encodeURIComponent("correct horse battery").replace(/%20/g, "+");
  assert.equal(form, "correct+horse+battery");
  assert.equal(spaced.string(`a=${form}`), "a=[secret:S]");
});

await check("hex, lower and upper case", () => {
  const hex = Buffer.from(SECRET, "utf8").toString("hex");
  assert.equal(redactor.string(`h:${hex}`), `h:${MARK}`);
  assert.equal(redactor.string(`h:${hex.toUpperCase()}`), `h:${MARK}`);
});

const plain = createRedactor({ TOKEN: "tok_8f3a9c1e77b2d4" });
const bytes = Buffer.from("tok_8f3a9c1e77b2d4", "utf8");

for (const prefix of [0, 1, 2, 3, 4, 5]) {
  for (const encoding of ["base64", "base64url"] as const) {
    await check(`${encoding} of the value after ${prefix} byte(s) of other text (alignment ${prefix % 3})`, () => {
      const before = Buffer.from("x".repeat(prefix));
      const after = Buffer.from(">>tail");
      const stream = Buffer.concat([before, bytes, after]).toString(encoding);
      const out = plain.string(`stream=${stream}`);
      assert.ok(out.includes("[secret:TOKEN]"), `not redacted: ${out}`);
      // What is left cannot be decoded back to the value: the middle was removed.
      assert.ok(!out.includes(bytes.toString(encoding)), "the aligned form is still there");
    });
  }
}

await check("base64 of the value on its own (alignment 0, padded)", () => {
  const out = plain.string(`b=${bytes.toString("base64")}`);
  assert.ok(out.includes("[secret:TOKEN]"));
});

console.log("\nsecret-redactor: what it leaves alone");

await check("values shorter than the minimum are not redacted", () => {
  const short = createRedactor({ FLAG: "a".repeat(MIN_SECRET_LENGTH - 1), REGION: "eu" });
  assert.equal(short.empty, true);
  assert.equal(short.string("a".repeat(MIN_SECRET_LENGTH - 1) + " eu"), "a".repeat(MIN_SECRET_LENGTH - 1) + " eu");
});

await check("ordinary text is untouched", () => {
  assert.equal(redactor.string("nothing to see here"), "nothing to see here");
});

await check("a redactor with nothing to redact returns the same value, not a copy", () => {
  const value = { a: [1, 2, { b: "c" }] };
  assert.equal(createRedactor({}).value(value), value);
});

console.log("\nsecret-redactor: structures");

await check("nested outputs: strings, arrays, object keys and numbers", () => {
  const pin = createRedactor({ PIN: "482913", KEY: "abcdef-123456" });
  const out = pin.value({
    list: ["x", "has abcdef-123456 inside"],
    deep: { n: 482913, [`abcdef-123456`]: 1 },
    ok: 7,
  });
  assert.deepEqual(out, {
    list: ["x", "has [secret:KEY] inside"],
    deep: { n: "[secret:PIN]", "[secret:KEY]": 1 },
    ok: 7,
  });
});

await check("an event's identity fields are never rewritten", () => {
  const odd = createRedactor({ ID: "cell-12345" });
  const event = odd.record({ type: "cell:log", runId: "r1", notebookId: "n1", cellId: "cell-12345", payload: "cell-12345" });
  assert.equal(event.cellId, "cell-12345");
  assert.equal(event.payload, "[secret:ID]");
});

await check("two secrets with one value are named once, and the longer value wins when one contains the other", () => {
  const both = createRedactor({ SHORT: "secret-abc", LONG: "secret-abc-and-more" });
  assert.equal(both.string("x secret-abc-and-more y secret-abc"), "x [secret:LONG] y [secret:SHORT]");
});

console.log("\nsecret-redactor: at the emitter (the one place run output passes)");

await check("every event the emitter hands to its sink is redacted, identity intact", () => {
  const seen: RunEvent[] = [];
  const ee = createRunEmitter({ runId: "run-1", notebookId: "nb-1" }, (e) => seen.push(e), plain);
  ee.emit("cell:log", { type: "cell:log", cellId: "c1", level: "info", payload: "token is tok_8f3a9c1e77b2d4" });
  ee.emit("cell:done", { type: "cell:done", cellId: "c1", output: { hidden: "tok_8f3a9c1e77b2d4" }, written: ["hidden"] });
  ee.emit("cell:error", { type: "cell:error", cellId: "c1", error: `boom ${bytes.toString("base64")}` });
  ee.emit("run:error", { type: "run:error", error: "failed with tok_8f3a9c1e77b2d4" });
  const text = JSON.stringify(seen);
  assert.ok(!text.includes("tok_8f3a9c1e77b2d4"));
  assert.ok(!text.includes(bytes.toString("base64")));
  assert.equal(seen.length, 4);
  assert.equal(seen[0].runId, "run-1");
  assert.equal(seen[0].cellId, "c1");
  assert.equal(seen[0].payload, "token is [secret:TOKEN]");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

/**
 * Python `main` detection: only a real top-level `def main(` / `async def main(` outside
 * comments and strings stops the engine wrapping the code. No database needed.
 *
 *   pnpm --filter @zaa-tool/engine test python-runner-detect
 */
import assert from "node:assert/strict";
import { definesMain, runPythonNode } from "../src/core/python-runner.js";

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

console.log("\ndefinesMain");

await check("a real main is detected, sync or async, with odd spacing", () => {
  assert.equal(definesMain("def main(inputs):\n    return {}"), true);
  assert.equal(definesMain("import os\nasync def main(inputs):\n    return {}"), true);
  assert.equal(definesMain("def  main (inputs):\n    return {}"), true);
  assert.equal(definesMain("x = 1\r\ndef main(inputs):\r\n    return {}"), true);
});

await check("comments, strings, docstrings and nested defs do not count", () => {
  assert.equal(definesMain("# def main(inputs):\nreturn {}"), false);
  assert.equal(definesMain("x = 'def main(' \nreturn {}"), false);
  assert.equal(definesMain('"""\ndef main(inputs):\n"""\nreturn {}'), false);
  assert.equal(definesMain("def helper():\n    def main(x):\n        pass\nreturn {}"), false);
  assert.equal(definesMain("def domain(x):\n    pass\nreturn {}"), false);
});

await check("a real main after a closed docstring is still detected", () => {
  assert.equal(definesMain('"""doc"""\ndef main(inputs):\n    return {}'), true);
  assert.equal(definesMain("'''\nnotes\n'''\nasync def main(inputs):\n    return {}"), true);
});

console.log("\nthrough the real runner");

await check("`# def main(` in a comment and no real main still runs wrapped", async () => {
  const result = await runPythonNode("# def main(inputs): is not defined here\nreturn {'v': 1}", {}, 15_000);
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { v: 1 });
});

await check("a string containing 'def main(' does not fool it", async () => {
  const result = await runPythonNode("s = 'def main('\nreturn {'v': s}", {}, 15_000);
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { v: "def main(" });
});

await check("a docstring-style string at column 0 does not fool it", async () => {
  const result = await runPythonNode('"""\ndef main(inputs):\n"""\nreturn {"v": 2}', {}, 15_000);
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { v: 2 });
});

await check("a real `def main(inputs)` is still used", async () => {
  const result = await runPythonNode("def main(inputs):\n    return {'v': inputs['n'] + 1}", { n: 4 }, 15_000);
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { v: 5 });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

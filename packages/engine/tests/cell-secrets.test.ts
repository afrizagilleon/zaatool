/**
 * S-04: a notebook's secrets reach its cell without being in the process's initial
 * environment, which on Linux is readable as /proc/<pid>/environ by any process of the same
 * uid. The cell's own contract is unchanged: `process.env.X` / `os.environ["X"]` work, and a
 * Python cell's subprocesses inherit them. No database needed.
 *
 *   pnpm --filter @zaa-tool/engine test cell-secrets
 */
import assert from "node:assert/strict";
import { runJsNode } from "../src/core/js-runner.js";
import { runPythonNode } from "../src/core/python-runner.js";

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

const SECRETS = { ZZ_S04_TOKEN: "needle-s04-value" };
const onLinux = process.platform === "linux";

console.log("\ncell-secrets (S-04)");

await check("a JS cell reads a declared secret from process.env", async () => {
  const res = await runJsNode("return { v: process.env.ZZ_S04_TOKEN };", {}, 20000, undefined, SECRETS);
  assert.equal(res.error, undefined, res.error);
  assert.deepEqual(res.output, { v: "needle-s04-value" });
});

await check("a JS cell without the secret does not see it", async () => {
  const res = await runJsNode("return { v: process.env.ZZ_S04_TOKEN ?? null };", {}, 20000);
  assert.deepEqual(res.output, { v: null });
});

await check("a Python cell reads a declared secret from os.environ", async () => {
  const res = await runPythonNode("return {'v': os.environ.get('ZZ_S04_TOKEN')}", {}, 20000, undefined, SECRETS);
  assert.equal(res.error, undefined, res.error);
  assert.deepEqual(res.output, { v: "needle-s04-value" });
});

await check("a Python cell's subprocess inherits the secret", async () => {
  const code =
    "import subprocess, sys\n" +
    "out = subprocess.run([sys.executable, '-c', 'import os; print(os.environ.get(\"ZZ_S04_TOKEN\"))'], capture_output=True, text=True)\n" +
    "return {'v': out.stdout.strip()}";
  const res = await runPythonNode(code, {}, 20000, undefined, SECRETS);
  assert.equal(res.error, undefined, res.error);
  assert.deepEqual(res.output, { v: "needle-s04-value" });
});

await check("the secret is in no log line", async () => {
  const res = await runPythonNode("print('hello')\nreturn {'v': 1}", {}, 20000, undefined, SECRETS);
  assert.ok(!JSON.stringify(res.logs).includes("needle-s04-value"));
});

// /proc/<pid>/environ is Linux only; elsewhere there is nothing to read.
if (onLinux) {
  await check("a Python cell's own /proc/self/environ does not hold the secret", async () => {
    const res = await runPythonNode(
      "data = open('/proc/self/environ','rb').read()\nreturn {'in_initial_env': b'needle-s04-value' in data, 'in_os_environ': 'ZZ_S04_TOKEN' in os.environ}",
      {},
      20000,
      undefined,
      SECRETS
    );
    assert.equal(res.error, undefined, res.error);
    assert.deepEqual(res.output, { in_initial_env: false, in_os_environ: true });
  });

  await check("a JS cell's /proc/self/environ does not hold the secret", async () => {
    const res = await runJsNode(
      "return { found: Buffer.from(require('fs').readFileSync('/proc/self/environ')).includes('needle-s04-value') };",
      {},
      20000,
      undefined,
      SECRETS
    );
    // The permission model may refuse the read outright; either way the secret is not seen.
    assert.ok(res.error !== undefined || (res.output as { found: boolean }).found === false);
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * A Python cell that has returned keeps its result even when something it started keeps the
 * process (or its stdout) alive. Before: the result waited for `close`, so a non-daemon thread
 * or a child holding stdout turned a finished cell into "Timeout after ...ms".
 *
 *   pnpm --filter @zaa-tool/engine test python-cell-result
 */
import assert from "node:assert/strict";
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

await check("a non-daemon thread does not turn a returned cell into a timeout", async () => {
  const r = await runPythonNode(
    `import threading, time
threading.Thread(target=lambda: time.sleep(60)).start()
return {"ok": 1}`,
    {},
    4000
  );
  assert.equal(r.error, undefined);
  assert.deepEqual(r.output, { ok: 1 });
  assert.ok(r.ms < 3500, `took ${r.ms} ms`);
});

await check("a child holding stdout does not turn a returned cell into a timeout", async () => {
  const r = await runPythonNode(
    `import subprocess, sys
# Ends on its own: on Windows taskkill /T cannot reach an orphan (S-10), so a longer
# sleep would outlive the test run.
subprocess.Popen([sys.executable, "-c", "import time; time.sleep(8)"])
return {"ok": 2}`,
    {},
    4000
  );
  assert.equal(r.error, undefined);
  assert.deepEqual(r.output, { ok: 2 });
  assert.ok(r.ms < 3500, `took ${r.ms} ms`);
});

await check("an error frame is kept as the error too", async () => {
  const r = await runPythonNode(
    `import threading, time
threading.Thread(target=lambda: time.sleep(60)).start()
raise ValueError("nope")`,
    {},
    4000
  );
  assert.match(r.error ?? "", /ValueError: nope/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

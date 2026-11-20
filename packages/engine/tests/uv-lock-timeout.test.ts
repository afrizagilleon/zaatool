/**
 * `resolvePythonLockedPackages` must not wait forever on `uv`. UV_PATH points at node, and
 * the `run` argument the function passes first is a script named `run` in a temp folder
 * that the test makes the working directory, so node executes it as the "slow uv".
 * No database needed.
 *
 *   pnpm --filter @zaa-tool/engine test uv-lock-timeout
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePythonLockedPackages } from "../src/core/python-runner.js";

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

const originalCwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-k26-"));
const pidFile = path.join(dir, "pid.txt");
process.chdir(dir);
process.env.UV_PATH = process.execPath;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

try {
  console.log("\nuv lock timeout");

  await check("a hung uv is killed and the deploy gets a clear timeout error", async () => {
    fs.writeFileSync(
      path.join(dir, "run"),
      `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`
    );
    process.env.UV_LOCK_TIMEOUT_SECONDS = "1";
    const started = Date.now();
    await assert.rejects(
      () => resolvePythonLockedPackages(["zz-fake-pkg"]),
      /timed out after 1s.*UV_LOCK_TIMEOUT_SECONDS/
    );
    assert.ok(Date.now() - started < 10_000, "took far longer than the timeout");

    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(alive(pid), false, `process ${pid} survived the timeout`);
  });

  await check("a fast failing uv still falls back to the declared requirements", async () => {
    fs.writeFileSync(path.join(dir, "run"), "process.exit(3);");
    process.env.UV_LOCK_TIMEOUT_SECONDS = "30";
    assert.deepEqual(await resolvePythonLockedPackages(["zz-fake-pkg"]), ["zz-fake-pkg"]);
  });

  await check("a fast successful uv is resolved normally", async () => {
    fs.writeFileSync(path.join(dir, "run"), 'console.log(JSON.stringify(["zz-fake-pkg==1.0"]));');
    assert.deepEqual(await resolvePythonLockedPackages(["zz-fake-pkg"]), ["zz-fake-pkg==1.0"]);
  });
} finally {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * FX-20 D-3 / D-4: an owner's home, and a folder for every cell process that is made before
 * the process starts and gone after it ends — finished, failed, timed out or cancelled.
 *
 * The chown/chmod calls only take effect as root on Linux (see sandbox-linux-root.test.ts for
 * the kernel doing it); here they are recorded through an in-memory `fs`, and the real-disk
 * part runs everywhere.
 *
 *   pnpm --filter @zaa-tool/engine test fx20-workspace
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCellHost } from "../src/core/cell-workspace.js";
import { createUidPool } from "../src/core/uid-sweep.js";
import { runJsNode } from "../src/core/js-runner.js";
import { runPythonNode } from "../src/core/python-runner.js";
import type { SandboxConfig } from "../src/core/sandbox-identity.js";
import { fakeWorkspaceFs } from "./fake-workspace-fs.js";

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

const config: SandboxConfig = { uidBase: 20000, uidCount: 40000, gid: 10001, home: "/home/sandbox" };
const sweptNow = () => createUidPool({ base: 20000, count: 40000, sweeper: async () => true, start: 0, retryDelayMs: 0 });

console.log("\nprocess folder in the sandbox (recorded, as root on Linux would do it)");

await check("every process folder is 128 random bits, its own uid's and its owner's group, 0700, under cells/", () => {
  const rec = fakeWorkspaceFs();
  const host = createCellHost({ sandbox: { config, gid: 20007, pool: sweptNow() }, fs: rec.fs });
  const one = host.open();
  const two = host.open();
  assert.match(one.dir, /^\/home\/sandbox\/owners\/20007\/cells\/[0-9a-f]{32}$/);
  assert.notEqual(one.dir, two.dir);
  assert.deepEqual(rec.tree.get(one.dir), { kind: "dir", uid: one.spawn.options.uid, gid: 20007, mode: 0o700 });
  assert.notEqual(one.spawn.options.uid, two.spawn.options.uid, "two processes of one owner share a uid");
  assert.deepEqual(one.spawn.options, { uid: one.spawn.options.uid, gid: 20007, cwd: one.dir });
  assert.equal(one.spawn.env.HOME, "/home/sandbox/owners/20007/home");
  assert.equal(one.spawn.env.TMPDIR, "/home/sandbox/owners/20007/tmp");
  assert.equal(one.spawn.env.UV_CACHE_DIR, "/home/sandbox/owners/20007/.cache/uv");
  assert.equal(one.spawn.env.USER, "sandbox");
  assert.equal(one.spawn.env.LOGNAME, "sandbox");
});

await check("dispose gives the uid back only after the sweep, then removes the empty folder", async () => {
  const rec = fakeWorkspaceFs();
  let finish: (clean: boolean) => void = () => undefined;
  const swept: Array<{ uid: number; dir?: string }> = [];
  const pool = createUidPool({
    base: 20000,
    count: 1,
    start: 0,
    sweeper: (t) => {
      swept.push({ uid: t.uid, dir: t.dir });
      return new Promise<boolean>((resolve) => (finish = resolve));
    },
  });
  const ws = createCellHost({ sandbox: { config, gid: 20007, pool }, fs: rec.fs }).open();
  const closing = ws.dispose();
  assert.equal(ws.dispose(), closing, "a second dispose is the same one");
  assert.deepEqual(swept, [{ uid: 20000, dir: ws.dir }]);
  assert.ok(!rec.calls.some((c) => c.op === "rmdir"), "removed before the sweep ended");
  assert.throws(() => createCellHost({ sandbox: { config, gid: 20007, pool }, fs: rec.fs }).open(), /SANDBOX_UID_COUNT/);
  finish(true);
  await closing;
  assert.ok(rec.calls.some((c) => c.op === "rmdir" && c.path === ws.dir));
  assert.equal(rec.calls.filter((c) => c.op === "rm").length, 0, "root removed something recursively");
  createCellHost({ sandbox: { config, gid: 20007, pool }, fs: rec.fs }).open();
});

await check("two owners never share a home, a cache or a folder", () => {
  const rec = fakeWorkspaceFs();
  const pool = sweptNow();
  const a = createCellHost({ sandbox: { config, gid: 20000, pool }, fs: rec.fs }).open();
  const b = createCellHost({ sandbox: { config, gid: 20001, pool }, fs: rec.fs }).open();
  assert.notEqual(a.spawn.env.HOME, b.spawn.env.HOME);
  assert.notEqual(a.spawn.env.UV_CACHE_DIR, b.spawn.env.UV_CACHE_DIR);
  assert.ok(!b.dir.startsWith("/home/sandbox/owners/20000"));
  assert.notEqual(a.spawn.options.gid, b.spawn.options.gid);
});

await check("a program written for the process is its uid's, 0600, and never overwrites", () => {
  const rec = fakeWorkspaceFs();
  const ws = createCellHost({ sandbox: { config, gid: 20007, pool: sweptNow() }, fs: rec.fs }).open();
  const file = ws.writeScript("cell.py", "print(1)");
  assert.equal(file, `${ws.dir}/cell.py`);
  assert.deepEqual(rec.tree.get(file), { kind: "file", uid: ws.spawn.options.uid, gid: 20007, mode: 0o600 });
  assert.throws(() => ws.writeScript("cell.py", "print(2)"), /EEXIST/);
});


console.log("\nprocess folder (real disk, no uid change)");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zz-fx20-ws-"));
const host = createCellHost({ tempRoot, ownerKey: "zz-owner" });
const cellsDir = path.join(tempRoot, "owners", "zz-owner", "cells");
const leftovers = (): string[] => (fs.existsSync(cellsDir) ? fs.readdirSync(cellsDir) : []);

await check("opened folder exists and is removed by dispose, twice is harmless", () => {
  const ws = host.open();
  assert.ok(fs.statSync(ws.dir).isDirectory());
  ws.dispose();
  assert.ok(!fs.existsSync(ws.dir));
  ws.dispose();
});

await check("a JS cell runs, and its folder is gone afterwards", async () => {
  const res = await runJsNode("return { ok: 1 };", {}, 20000, undefined, {}, [], undefined, undefined, [], undefined, host);
  assert.equal(res.error, undefined);
  assert.deepEqual(leftovers(), []);
});

await check("a failing JS cell leaves nothing either", async () => {
  const res = await runJsNode("throw new Error('boom');", {}, 20000, undefined, {}, [], undefined, undefined, [], undefined, host);
  assert.match(res.error ?? "", /boom/);
  assert.deepEqual(leftovers(), []);
});

await check("a JS cell that times out leaves nothing", async () => {
  const res = await runJsNode("await new Promise(() => {});", {}, 1500, undefined, {}, [], undefined, undefined, [], undefined, host);
  assert.match(res.error ?? "", /Timeout/);
  assert.deepEqual(leftovers(), []);
});

await check("the folder exists while the JS process runs, and a cancel removes it", async () => {
  const controller = new AbortController();
  const running = runJsNode(
    "await new Promise((r) => setTimeout(r, 15000)); return {};",
    {}, 30000, undefined, {}, [], undefined, undefined, [], controller.signal, host
  );
  const deadline = Date.now() + 10000;
  while (leftovers().length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.equal(leftovers().length, 1, "no folder while the process was running");
  controller.abort(new Error("Cancelled by test"));
  const res = await running;
  assert.match(res.error ?? "", /Cancelled by test/);
  assert.deepEqual(leftovers(), []);
});

await check("a Python cell runs, fails, and times out without leaving a folder", async () => {
  const ok = await runPythonNode("return {'v': 1}", {}, 20000, undefined, {}, [], undefined, undefined, [], undefined, host);
  assert.equal(ok.error, undefined, ok.error);
  assert.deepEqual(leftovers(), []);

  const bad = await runPythonNode("raise ValueError('boom')", {}, 20000, undefined, {}, [], undefined, undefined, [], undefined, host);
  assert.match(bad.error ?? "", /boom/);
  assert.deepEqual(leftovers(), []);

  const slow = await runPythonNode("import time\ntime.sleep(30)", {}, 1500, undefined, {}, [], undefined, undefined, [], undefined, host);
  assert.match(slow.error ?? "", /Timeout/);
  assert.deepEqual(leftovers(), []);
});

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

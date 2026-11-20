/**
 * FX-20 D-3 / D-4: an owner's home, and a folder for every cell process that is made before
 * the process starts and gone after it ends — finished, failed, timed out or cancelled.
 *
 * The chown/chmod calls only take effect as root on Linux (see T-07 for the kernel doing it);
 * here they are recorded through an injected `fs`, and the real-disk part runs everywhere.
 *
 *   pnpm --filter @zaa-tool/engine test fx20-workspace
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCellHost, prepareOwnerHome, type WorkspaceFs } from "../src/core/cell-workspace.js";
import { runJsNode } from "../src/core/js-runner.js";
import { runPythonNode } from "../src/core/python-runner.js";
import type { SandboxConfig } from "../src/core/sandbox-identity.js";

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

function recordingFs(): { fs: WorkspaceFs; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fs: {
      mkdirSync: (dir) => void calls.push(`mkdir ${dir}`),
      chmodSync: (target, mode) => void calls.push(`chmod ${mode.toString(8)} ${target}`),
      chownSync: (target, uid, gid) => void calls.push(`chown ${uid}:${gid} ${target}`),
      rmSync: (target) => void calls.push(`rm ${target}`),
    },
  };
}

console.log("\nowner home (recorded, as root on Linux would do it)");

await check("owners is root-only to list (0711); the owner's home and its folders are the owner's, 0700", () => {
  const rec = recordingFs();
  const home = prepareOwnerHome(config, 20007, rec.fs);
  assert.equal(home, "/home/sandbox/owners/20007");
  assert.ok(rec.calls.includes("chmod 711 /home/sandbox/owners"));
  assert.ok(!rec.calls.some((c) => c.startsWith("chown") && c.endsWith("/home/sandbox/owners")), "owners must stay root's");
  for (const dir of ["", "/tmp", "/.cache/uv", "/cells"]) {
    assert.ok(rec.calls.includes(`chown 20007:10001 ${home}${dir}`), `no chown for ${dir}`);
    assert.ok(rec.calls.includes(`chmod 700 ${home}${dir}`), `no chmod 700 for ${dir}`);
  }
});

await check("every process folder is 128 random bits, the owner's, 0700, under the owner's cells/", () => {
  const rec = recordingFs();
  const host = createCellHost({ sandbox: { config, uid: 20007 }, fs: rec.fs });
  const one = host.open();
  const two = host.open();
  assert.match(one.dir, /^\/home\/sandbox\/owners\/20007\/cells\/[0-9a-f]{32}$/);
  assert.notEqual(one.dir, two.dir);
  assert.ok(rec.calls.includes(`chown 20007:10001 ${one.dir}`));
  assert.ok(rec.calls.includes(`chmod 700 ${one.dir}`));
  one.dispose();
  assert.ok(rec.calls.includes(`rm ${one.dir}`));
  assert.deepEqual(one.spawn.options, { uid: 20007, gid: 10001 });
  assert.equal(one.spawn.env.HOME, "/home/sandbox/owners/20007");
  assert.equal(one.spawn.env.UV_CACHE_DIR, "/home/sandbox/owners/20007/.cache/uv");
});

await check("two owners never share a home, a cache or a folder", () => {
  const rec = recordingFs();
  const a = createCellHost({ sandbox: { config, uid: 20000 }, fs: rec.fs }).open();
  const b = createCellHost({ sandbox: { config, uid: 20001 }, fs: rec.fs }).open();
  assert.notEqual(a.spawn.env.HOME, b.spawn.env.HOME);
  assert.notEqual(a.spawn.env.UV_CACHE_DIR, b.spawn.env.UV_CACHE_DIR);
  assert.ok(!b.dir.startsWith(a.spawn.env.HOME));
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

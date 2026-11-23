/**
 * S-14: a disk quota per notebook owner, and the cleanup that makes it reachable again.
 * Real folders, so the symlink rules (C-01) are tested against the real filesystem; the
 * `uv cache prune` step is replaced. On Windows a symlink may need rights the test user
 * lacks, and those checks are skipped with a line saying so.
 *
 *   pnpm --filter @zaa-tool/engine test owner-disk
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDirContents, createOwnerDisk, measureDir, refusalMessage, withOwnerDisk } from "../src/core/owner-disk.js";
import { createCellHost, type CellHost } from "../src/core/cell-workspace.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import { runNotebook } from "../src/core/notebook-runner.js";
import { windowsProductionWarnings } from "../src/core/windows-production.js";
import type { NotebookJson } from "@zaa-tool/shared";

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zaa-owner-disk-"));
const MB = 1024 * 1024;
const fill = (file: string, bytes: number): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
};
const hostFor = (key: string): CellHost => createCellHost({ tempRoot: root, ownerKey: key });

/** Tries a symlink; false (and a note) where the platform refuses to make one. */
function trySymlink(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "dir");
    return true;
  } catch {
    console.log("  skip symlink checks: this platform will not make a symlink");
    return false;
  }
}

console.log("\nmeasuring");

await check("counts what is on disk and ignores a symlink's target", async () => {
  const dir = path.join(root, "m1");
  fill(path.join(dir, "a.bin"), 3 * MB);
  fill(path.join(dir, "sub", "b.bin"), 2 * MB);
  const outside = path.join(root, "m1-outside");
  fill(path.join(outside, "huge.bin"), 50 * MB);
  const linked = trySymlink(outside, path.join(dir, "link"));
  const { bytes, complete } = await measureDir(dir);
  assert.equal(complete, true);
  assert.ok(bytes >= 5 * MB, `counted the files (${bytes})`);
  if (linked) assert.ok(bytes < 8 * MB, `did not follow the link into 50 MB (${bytes})`);
});

await check("a hard-linked file is counted once", async () => {
  const dir = path.join(root, "m2");
  fill(path.join(dir, "a.bin"), 4 * MB);
  try {
    fs.linkSync(path.join(dir, "a.bin"), path.join(dir, "b.bin"));
  } catch {
    return;
  }
  const { bytes } = await measureDir(dir);
  assert.ok(bytes < 6 * MB, `counted once (${bytes})`);
});

await check("stops early once past the limit, and says so", async () => {
  const dir = path.join(root, "m3");
  for (let i = 0; i < 6; i++) fill(path.join(dir, `d${i}`, "f.bin"), MB);
  const m = await measureDir(dir, 2 * MB);
  assert.equal(m.complete, false);
  assert.ok(m.bytes > 2 * MB && m.bytes < 6 * MB);
});

await check("a missing folder, or a symlink as the root, measures as nothing", async () => {
  assert.deepEqual(await measureDir(path.join(root, "nope")), { bytes: 0, complete: true });
  const outside = path.join(root, "m4-outside");
  fill(path.join(outside, "x.bin"), MB);
  if (trySymlink(outside, path.join(root, "m4-link"))) {
    assert.deepEqual(await measureDir(path.join(root, "m4-link")), { bytes: 0, complete: true });
  }
});

console.log("\nclearing");

await check("empties a folder, unlinks a symlink without touching its target", async () => {
  const home = path.join(root, "c1");
  const tmp = path.join(home, "tmp");
  const outside = path.join(root, "c1-outside");
  fill(path.join(outside, "keep.txt"), 10);
  fill(path.join(tmp, "a", "b", "c.bin"), 100);
  fill(path.join(tmp, "d.bin"), 100);
  const linked = trySymlink(outside, path.join(tmp, "evil"));
  assert.equal(await clearDirContents(tmp, home), true);
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.ok(fs.existsSync(path.join(outside, "keep.txt")), "the link's target survived");
  void linked;
});

await check("refuses when the folder is itself a symlink out of the owner's home", async () => {
  const home = path.join(root, "c2");
  fs.mkdirSync(home, { recursive: true });
  const outside = path.join(root, "c2-outside");
  fill(path.join(outside, "keep.txt"), 10);
  if (!trySymlink(outside, path.join(home, "tmp"))) return;
  assert.equal(await clearDirContents(path.join(home, "tmp"), home), false);
  assert.ok(fs.existsSync(path.join(outside, "keep.txt")));
});

console.log("\nquota");

await check("an owner over quota is refused, the cell does not run, another owner is unaffected", async () => {
  const disk = createOwnerDisk({ limitBytes: () => 2 * MB, idleMs: 3_600_000 });
  const big = hostFor("q-big");
  const small = hostFor("q-small");
  fill(path.join(big.home, "tmp", "junk.bin"), 3 * MB);
  fill(path.join(small.home, "tmp", "ok.bin"), 100);

  let ran = 0;
  const run = async (): Promise<string> => {
    ran += 1;
    return "ran";
  };
  const refused = (message: string): string => `refused: ${message}`;

  const a = await disk.guard(big, run, refused);
  assert.ok(a.startsWith("refused: Not enough disk space"), a);
  assert.equal(ran, 0);
  assert.equal(await disk.guard(small, run, refused), "ran");
  assert.equal(ran, 1);
});

await check("a measurement is reused inside the TTL and renewed after it", async () => {
  let t = 0;
  const disk = createOwnerDisk({ limitBytes: () => 2 * MB, ttlMs: 1000, now: () => t, idleMs: 3_600_000 });
  const host = hostFor("q-ttl");
  fs.mkdirSync(path.join(host.home, "tmp"), { recursive: true });
  const run = async (): Promise<string> => "ran";
  const refused = (m: string): string => m;
  assert.equal(await disk.guard(host, run, refused), "ran");
  fill(path.join(host.home, "tmp", "late.bin"), 3 * MB);
  assert.equal(await disk.guard(host, run, refused), "ran", "inside the TTL the old measurement stands");
  t = 2000;
  assert.notEqual(await disk.guard(host, run, refused), "ran", "after it the folder is measured again");
});

await check("tidy empties tmp, so the owner can run again", async () => {
  const disk = createOwnerDisk({ limitBytes: () => 2 * MB, idleMs: 3_600_000 });
  const host = hostFor("q-tidy");
  fill(path.join(host.home, "tmp", "junk.bin"), 3 * MB);
  const run = async (): Promise<string> => "ran";
  assert.notEqual(await disk.guard(host, run, (m) => m), "ran");
  await disk.tidy(host);
  assert.equal(await disk.guard(host, run, (m) => m), "ran");
});

await check("the idle timer does the cleanup on its own", async () => {
  const disk = createOwnerDisk({ limitBytes: () => 2 * MB, ttlMs: 0, idleMs: 20 });
  const host = hostFor("q-idle");
  fill(path.join(host.home, "tmp", "junk.bin"), 3 * MB);
  assert.notEqual(await disk.guard(host, async () => "ran", (m) => m), "ran");
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(fs.readdirSync(path.join(host.home, "tmp")), []);
});

await check("a cache past its share is pruned, then emptied if pruning was not enough", async () => {
  const jobs: string[] = [];
  const pruneFrees = new Map<string, boolean>();
  const disk = createOwnerDisk({
    limitBytes: () => 4 * MB,
    idleMs: 3_600_000,
    // The real cleaner runs a process with a cell's identity; here we only see what it is asked.
    clean: async (host, job) => {
      jobs.push(job);
      const cache = path.join(host.home, ".cache", "uv");
      if (job === "uv-cache" || (job === "uv-prune" && pruneFrees.get(host.home))) {
        fs.rmSync(cache, { recursive: true, force: true });
      }
    },
  });
  const stubborn = hostFor("q-cache");
  fill(path.join(stubborn.home, ".cache", "uv", "wheel.bin"), 3 * MB);
  await disk.tidy(stubborn);
  assert.deepEqual(jobs, ["tmp", "uv-prune", "uv-cache"]);
  assert.equal(fs.existsSync(path.join(stubborn.home, ".cache", "uv")), false);

  jobs.length = 0;
  const prunable = hostFor("q-cache2");
  pruneFrees.set(prunable.home, true);
  fill(path.join(prunable.home, ".cache", "uv", "wheel.bin"), 3 * MB);
  await disk.tidy(prunable);
  assert.deepEqual(jobs, ["tmp", "uv-prune"], "pruning was enough, so the cache is not emptied");

  jobs.length = 0;
  const small = hostFor("q-cache3");
  fill(path.join(small.home, ".cache", "uv", "wheel.bin"), MB);
  await disk.tidy(small);
  assert.deepEqual(jobs, ["tmp"], "a cache inside its share is left alone");
});

await check("a host with no folder of its own (a script) is never limited", async () => {
  assert.equal(await withOwnerDisk(undefined, async () => "ran", (m) => m), "ran");
});

console.log("\nrunning a notebook");

await check("runNotebook fails the cell with the quota message and starts nothing", async () => {
  const old = process.env.MAX_OWNER_DISK_MB;
  process.env.MAX_OWNER_DISK_MB = "1";
  try {
    const host = hostFor("q-run");
    fill(path.join(host.home, "tmp", "junk.bin"), 3 * MB);
    const nb: NotebookJson = {
      version: "1",
      id: "nb-disk",
      name: "Disk",
      runtime: "node",
      steps: [{ id: "c1", kind: "cell", code: "return { x: 1 };" }],
    };
    const result = await runNotebook(compileNotebook(nb), { host });
    assert.equal(result.status, "failed");
    assert.match(result.errors[0], /Not enough disk space/);
    assert.match(result.errors[0], /MAX_OWNER_DISK_MB/);
  } finally {
    if (old === undefined) delete process.env.MAX_OWNER_DISK_MB;
    else process.env.MAX_OWNER_DISK_MB = old;
  }
});

await check("the message names the usage and the limit", () => {
  const text = refusalMessage(2_200 * MB, 2048 * MB);
  assert.match(text, /2200 MB/);
  assert.match(text, /2048 MB/);
});

console.log("\nS-10 / S-12: Windows in production");

await check("win32 + NODE_ENV=production warns; nothing else does", () => {
  assert.equal(windowsProductionWarnings("win32", { NODE_ENV: "production" }).length, 1);
  assert.match(windowsProductionWarnings("win32", { NODE_ENV: "production" })[0], /NOT sandboxed/);
  assert.deepEqual(windowsProductionWarnings("win32", {}), []);
  assert.deepEqual(windowsProductionWarnings("win32", { NODE_ENV: "development" }), []);
  assert.deepEqual(windowsProductionWarnings("linux", { NODE_ENV: "production" }), []);
  assert.deepEqual(windowsProductionWarnings("darwin", { NODE_ENV: "production" }), []);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * S-14 against a real kernel: the disk quota refuses an owner past a small limit, and the
 * clean-up that makes room again is done by a process with a cell's identity (a uid from the
 * pool, the owner's group), never by root, and never through a symlink a cell planted (C-01).
 * Linux, as root, with the SANDBOX_* variables the image sets; anywhere else it says so and
 * passes, because nothing here can be shown without a second uid.
 *
 *   docker run --rm --cap-add SYS_RESOURCE <image> pnpm exec tsx tests/owner-clean-linux.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCellHost, type CellHost } from "../src/core/cell-workspace.js";
import { createOwnerDisk, measureDir } from "../src/core/owner-disk.js";
import { cleanAsOwner } from "../src/core/owner-clean.js";
import { runPythonNode } from "../src/core/python-runner.js";
import { readSandboxConfig } from "../src/core/sandbox-identity.js";

const config = readSandboxConfig(process.env);
if (process.platform !== "linux" || process.getuid?.() !== 0 || !config) {
  console.log("owner-clean-linux: needs Linux, root and SANDBOX_GID; skipped.");
  process.exit(0);
}

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

const MB = 1024 * 1024;
const GID = config.uidBase + 300;
const inner = createCellHost({ sandbox: { config, gid: GID } });

/** The same host, recording the identity of every workspace opened through it. */
const opened: Array<{ uid: number | undefined; gid: number | undefined }> = [];
const host: CellHost = {
  home: inner.home,
  open(inputs?: unknown) {
    const workspace = inner.open(inputs);
    opened.push({ uid: workspace.spawn.options.uid, gid: workspace.spawn.options.gid });
    return workspace;
  },
};

/** A Python cell, as the owner, that runs `body` with TMPDIR and the uv cache folder in hand. */
async function asCell(body: string): Promise<Record<string, unknown>> {
  const code = `import os\ntmp = os.environ['TMPDIR']\ncache = os.environ['UV_CACHE_DIR']\n${body}\nreturn {'ok': True}`;
  const result = await runPythonNode(code, {}, 20_000, undefined, {}, [], undefined, undefined, [], undefined, inner);
  assert.equal(result.error, undefined, result.error);
  return result.output ?? {};
}

const tmp = path.join(inner.home, "tmp");
const cache = path.join(inner.home, ".cache", "uv");

/** Everything under /app, as `path size mode`, to show nothing there was touched. */
function snapshot(root: string): string[] {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const info = fs.lstatSync(full);
      lines.push(`${full} ${info.size} ${(info.mode & 0o7777).toString(8)} ${info.uid}`);
      if (info.isDirectory()) walk(full);
    }
  };
  walk(root);
  return lines;
}

console.log("\nthe quota, with a small limit");

await check("an owner past the limit is refused, and is let in again after the clean-up", async () => {
  const disk = createOwnerDisk({ limitBytes: () => 2 * MB, idleMs: 3_600_000 });
  await asCell("open(os.path.join(tmp, 'big.bin'), 'wb').write(b'x' * (5 * 1024 * 1024))");
  assert.ok((await measureDir(tmp)).bytes > 4 * MB, "the cell filled its temp folder");
  const refused = await disk.guard(host, async () => "ran", (message) => `refused: ${message}`);
  assert.match(refused, /^refused: Not enough disk space/);
  await disk.tidy(host);
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.equal(await disk.guard(host, async () => "ran", (message) => message), "ran");
});

console.log("\nthe clean-up runs as a cell, not as root");

await check("it opens a workspace: a uid from the pool, the owner's group, never root", async () => {
  opened.length = 0;
  await cleanAsOwner(host, "tmp");
  assert.equal(opened.length, 1);
  const { uid, gid } = opened[0];
  assert.ok(uid !== undefined && uid >= config.uidBase && uid < config.uidBase + config.uidCount, `uid ${uid}`);
  assert.equal(gid, GID);
});

await check("a folder that root made and the group cannot write to survives it: root is not the one deleting", async () => {
  const locked = path.join(tmp, "locked");
  fs.mkdirSync(locked, { mode: 0o750 });
  fs.chownSync(locked, 0, GID);
  fs.chmodSync(locked, 0o750);
  fs.writeFileSync(path.join(locked, "root-only.txt"), "mine");
  await asCell("open(os.path.join(tmp, 'plain.txt'), 'w').write('x')");
  await cleanAsOwner(host, "tmp");
  assert.equal(fs.existsSync(path.join(tmp, "plain.txt")), false, "the cell's own file was removed");
  assert.equal(fs.readFileSync(path.join(locked, "root-only.txt"), "utf8"), "mine", "what only root could remove stayed");
  fs.rmSync(locked, { recursive: true, force: true });
});

await check("files and nested folders a cell made, at the modes its umask gives, are emptied", async () => {
  await asCell(
    "os.makedirs(os.path.join(tmp, 'a', 'b', 'c'))\n" +
      "for rel in ('top.bin', 'a/mid.bin', 'a/b/c/deep.bin'):\n" +
      "    open(os.path.join(tmp, rel), 'wb').write(b'y' * 1000)\n" +
      "os.chmod(os.path.join(tmp, 'a', 'b'), 0o770)"
  );
  assert.ok(fs.readdirSync(tmp).length > 0);
  assert.equal(await cleanAsOwner(host, "tmp"), true);
  assert.deepEqual(fs.readdirSync(tmp), []);
});

console.log("\nsymlinks a cell planted");

await check("links to /app, to a file and to a folder, are unlinked and nothing behind them is touched", async () => {
  const before = snapshot("/app/packages/engine/src");
  const probe = "/app/packages/engine/package.json";
  const probeBefore = fs.statSync(probe);
  await asCell(
    "os.symlink('/app/packages/engine/src', os.path.join(tmp, 'evil-dir'))\n" +
      "os.symlink('/app/packages/engine/package.json', os.path.join(tmp, 'evil-file'))\n" +
      "os.makedirs(os.path.join(tmp, 'sub'))\n" +
      "os.symlink('/app', os.path.join(tmp, 'sub', 'evil-root'))"
  );
  assert.ok(fs.lstatSync(path.join(tmp, "evil-dir")).isSymbolicLink(), "the links were planted");
  assert.equal(await cleanAsOwner(host, "tmp"), true);
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.deepEqual(snapshot("/app/packages/engine/src"), before, "/app/packages/engine/src is exactly as it was");
  const probeAfter = fs.statSync(probe);
  assert.equal(probeAfter.mode, probeBefore.mode);
  assert.equal(probeAfter.uid, probeBefore.uid);
  assert.ok(fs.existsSync("/app/packages/engine/src/server-entry.ts"));
});

await check("the measurement does not follow a link either", async () => {
  await asCell("os.symlink('/usr', os.path.join(tmp, 'evil-usr'))");
  const { bytes } = await measureDir(inner.home);
  assert.ok(bytes < MB, `counted the link, not /usr (${bytes})`);
  await cleanAsOwner(host, "tmp");
});

console.log("\nthe package cache");

await check("uv cache prune runs as the owner and succeeds; the cache is emptied as the owner too", async () => {
  assert.equal(await cleanAsOwner(host, "uv-prune"), true, "uv cache prune exited 0");
  await asCell(
    "os.makedirs(os.path.join(cache, 'wheels', 'x'), exist_ok=True)\n" +
      "open(os.path.join(cache, 'wheels', 'x', 'w.whl'), 'wb').write(b'z' * (3 * 1024 * 1024))"
  );
  assert.ok((await measureDir(cache)).bytes > 2 * MB);
  assert.equal(await cleanAsOwner(host, "uv-cache"), true);
  assert.deepEqual(fs.readdirSync(cache), []);
  assert.ok(fs.lstatSync(cache).isDirectory(), "the folder itself stays, and stays root's");
  assert.equal(fs.lstatSync(cache).uid, 0);
});

await check("tidy brings a cache past its share back under it, as the owner", async () => {
  const disk = createOwnerDisk({ limitBytes: () => 4 * MB, idleMs: 3_600_000 });
  await asCell("open(os.path.join(cache, 'big.bin'), 'wb').write(b'z' * (3 * 1024 * 1024))");
  await disk.tidy(host);
  // uv's own prune drops what it does not recognise; whichever step did it, the share is met.
  assert.equal(fs.existsSync(path.join(cache, "big.bin")), false);
  assert.ok((await measureDir(cache)).bytes < 2 * MB);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

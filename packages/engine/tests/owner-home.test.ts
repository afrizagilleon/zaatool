/**
 * S-16 and C-01: the layout of an owner's folders, and the rule that the engine (root) never
 * operates by path inside a folder a cell can write to.
 *
 * C-01 was: a cell planted a symlink in its own home, and the engine's next `chown`/`chmod` of
 * that path (as root) followed it and gave the cell the engine's own source. Run on an
 * in-memory filesystem here; the same attack against the real kernel and the real runners is in
 * tests/sandbox-linux-root.test.ts (Linux, root only).
 *
 *   pnpm --filter @zaa-tool/engine test owner-home
 */
import assert from "node:assert/strict";
import { createCellHost } from "../src/core/cell-workspace.js";
import { OwnerHomeError, prepareOwnerHome } from "../src/core/owner-home.js";
import { createUidPool } from "../src/core/uid-sweep.js";
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
const GID = 20007;
const HOME = `/home/sandbox/owners/${GID}`;
const WRITABLE = [`${HOME}/tmp`, `${HOME}/home`, `${HOME}/.cache/uv`];
const VICTIM = "/app/packages/engine/src/core";
const pool = () => createUidPool({ base: 20000, count: 40000, sweeper: async () => true, start: 0, retryDelayMs: 0 });

function victim(rec: ReturnType<typeof fakeWorkspaceFs>): void {
  rec.plant(VICTIM, { kind: "dir", uid: 0, gid: 0, mode: 0o755 });
  rec.plant(`${VICTIM}/uid-sweep.ts`, { kind: "file", uid: 0, gid: 0, mode: 0o644 });
}
const victimIntact = (rec: ReturnType<typeof fakeWorkspaceFs>): boolean => {
  const dir = rec.tree.get(VICTIM)!;
  return dir.uid === 0 && dir.gid === 0 && dir.mode === 0o755 && rec.tree.get(`${VICTIM}/uid-sweep.ts`)!.uid === 0;
};

console.log("\nlayout (what is root's, what the group shares)");

await check("an owner's folders: root's, the owner's group, and only the shared ones are group-writable", () => {
  const rec = fakeWorkspaceFs();
  assert.equal(prepareOwnerHome(config, GID, rec.fs), HOME);
  const want: Record<string, [number, number]> = {
    "/home/sandbox/owners": [0, 0o711],
    [HOME]: [GID, 0o750],
    [`${HOME}/tmp`]: [GID, 0o2770],
    [`${HOME}/home`]: [GID, 0o2770],
    [`${HOME}/.cache`]: [GID, 0o750],
    [`${HOME}/.cache/uv`]: [GID, 0o2770],
    [`${HOME}/cells`]: [GID, 0o710],
  };
  for (const [dir, [gid, mode]] of Object.entries(want)) {
    const node = rec.tree.get(dir)!;
    assert.ok(node, `${dir} was not made`);
    assert.equal(node.uid, 0, `${dir} must be root's`);
    assert.equal(node.gid, gid, `${dir} group`);
    assert.equal(node.mode, mode, `${dir} mode ${node.mode.toString(8)}`);
  }
  // Nothing a cell could rename or replace is group-writable: tmp, .cache and cells sit in a
  // folder (the home) the group can enter but not change, and .cache and cells are not writable.
  assert.equal(rec.tree.get(HOME)!.mode & 0o020, 0);
  assert.equal(rec.tree.get(`${HOME}/.cache`)!.mode & 0o020, 0);
  assert.equal(rec.tree.get(`${HOME}/cells`)!.mode & 0o020, 0);
  // No other user can even enter an owner's folder.
  for (const dir of Object.keys(want).slice(1)) assert.equal(rec.tree.get(dir)!.mode & 0o007, 0, `${dir} is open to others`);
});

await check("preparing again changes nothing that is already right", () => {
  const rec = fakeWorkspaceFs();
  prepareOwnerHome(config, GID, rec.fs);
  const before = rec.calls.length;
  prepareOwnerHome(config, GID, rec.fs);
  const after = rec.calls.slice(before).filter((c) => c.op !== "mkdir" && c.op !== "lstat");
  assert.deepEqual(after, [], "a second run re-owned or re-moded something");
});

await check("the root-owned folders are fixed when they drifted, by path (they are root's, in root's folders)", () => {
  const rec = fakeWorkspaceFs();
  prepareOwnerHome(config, GID, rec.fs);
  rec.tree.get(`${HOME}/tmp`)!.mode = 0o777;
  prepareOwnerHome(config, GID, rec.fs);
  assert.equal(rec.tree.get(`${HOME}/tmp`)!.mode, 0o2770);
});

console.log("\nC-01: root never follows a path a cell can write to");

await check("preparing, opening, staging and disposing do no root operation by path inside any cell-writable folder", async () => {
  const rec = fakeWorkspaceFs();
  const host = createCellHost({ sandbox: { config, gid: GID, pool: pool() }, fs: rec.fs, grants: new Set(["a.txt"]), storageDir: "/storage" });
  const ws = host.open({ path: "a.txt" });
  ws.writeScript("cell.py", "x");
  ws.stageFrom({ path: "a.txt" });
  await ws.dispose();
  // The shared folders themselves are root's, made by root in root's folder: they may be set by
  // path. What is *inside* them, and the process folder (handed over by descriptor), may not.
  const inside = rec.rootOpsInside([...WRITABLE.map((dir) => dir + "/x").map((dir) => dir.slice(0, -2)), ws.dir]).filter(
    (c) => !WRITABLE.includes(c.path)
  );
  // createFile is the one write root makes into the process folder, by O_EXCL|O_NOFOLLOW, before the uid can exist.
  assert.deepEqual(
    inside.filter((c) => !(c.op === "createFile" && c.path === `${ws.dir}/cell.py`)),
    []
  );
});

await check("a symlink planted inside the shared folders is never chowned, chmoded or copied through", () => {
  const rec = fakeWorkspaceFs();
  victim(rec);
  const first = createCellHost({ sandbox: { config, gid: GID, pool: pool() }, fs: rec.fs });
  // The cell plants links wherever it can write: tmp, home, the uv cache.
  rec.plant(`${HOME}/tmp/x`, { kind: "symlink", target: VICTIM });
  rec.plant(`${HOME}/home/.cache`, { kind: "symlink", target: VICTIM });
  rec.plant(`${HOME}/.cache/uv/lock`, { kind: "symlink", target: VICTIM });
  // The next runs of the same owner: the very calls that were the exploit.
  for (let i = 0; i < 3; i += 1) {
    createCellHost({ sandbox: { config, gid: GID, pool: pool() }, fs: rec.fs }).open();
    first.open();
  }
  assert.ok(victimIntact(rec), "the engine's own folder was re-owned through a link");
});

await check("a layout folder replaced by a symlink (what the old layout let a cell do) is refused, not followed", () => {
  for (const entry of ["tmp", "home", ".cache", ".cache/uv", "cells"]) {
    const rec = fakeWorkspaceFs();
    victim(rec);
    prepareOwnerHome(config, GID, rec.fs);
    rec.plant(`${HOME}/${entry}`, { kind: "symlink", target: VICTIM });
    assert.throws(() => prepareOwnerHome(config, GID, rec.fs), OwnerHomeError, `${entry} was accepted as a symlink`);
    assert.ok(victimIntact(rec), `${entry}: the link was followed`);
  }
});

await check("a folder that still belongs to a cell's uid (not converted) is refused with what to do", () => {
  const rec = fakeWorkspaceFs();
  prepareOwnerHome(config, GID, rec.fs);
  rec.tree.get(`${HOME}/tmp`)!.uid = GID;
  assert.throws(() => prepareOwnerHome(config, GID, rec.fs), /belongs to uid 20007, not root.*Restart the engine/s);
});

await check("a process folder is made fresh: a pre-existing name is an error, never reused", () => {
  const rec = fakeWorkspaceFs();
  const host = createCellHost({ sandbox: { config, gid: GID, pool: pool() }, fs: rec.fs });
  const ws = host.open();
  assert.throws(() => rec.fs.mkdirSync(ws.dir, { mode: 0o700 }), /EEXIST/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

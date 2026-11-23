/**
 * S-16 migration: an installation that ran one uid per owner (`owners/<K>` owned by uid K,
 * 0700) is converted at start to root-owned, group K, without losing the owner's files, and
 * without following a symlink. Run on an in-memory tree; the same against a real kernel is in
 * tests/sandbox-linux-root.test.ts.
 *
 *   pnpm --filter @zaa-tool/engine test owner-home-migration
 */
import assert from "node:assert/strict";
import { migrateOwnerHomes, type MigrationEntry, type MigrationFs } from "../src/core/owner-home-migration.js";
import type { SandboxConfig } from "../src/core/sandbox-identity.js";
import type { StatLike } from "../src/core/workspace-fs.js";

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

interface N {
  kind: "dir" | "file" | "symlink";
  uid: number;
  gid: number;
  mode: number;
}

function memory(): { fs: MigrationFs; tree: Map<string, N>; add(path: string, node: Partial<N> & { kind: N["kind"] }): void; followed: string[] } {
  const tree = new Map<string, N>();
  const followed: string[] = [];
  const stat = (n: N): StatLike => ({
    isDirectory: () => n.kind === "dir",
    isSymbolicLink: () => n.kind === "symlink",
    uid: n.uid,
    gid: n.gid,
    mode: n.mode,
  });
  const children = (dir: string): string[] =>
    [...tree.keys()].filter((k) => k.startsWith(dir + "/") && !k.slice(dir.length + 1).includes("/"));
  const fs: MigrationFs = {
    readdirSync(dir): MigrationEntry[] {
      if (!tree.has(dir) && dir !== "/home/sandbox/owners") throw new Error("ENOENT");
      return children(dir).map((k) => {
        const n = tree.get(k)!;
        return { name: k.slice(dir.length + 1), isDirectory: () => n.kind === "dir", isSymbolicLink: () => n.kind === "symlink" };
      });
    },
    mkdirSync(dir) {
      tree.set(dir, { kind: "dir", uid: 0, gid: 0, mode: 0o755 });
    },
    lstatSync: (target) => (tree.has(target) ? stat(tree.get(target)!) : undefined),
    lchownSync(target, uid, gid) {
      Object.assign(tree.get(target)!, { uid, gid });
    },
    chmodSync(target, mode) {
      const n = tree.get(target)!;
      if (n.kind === "symlink") followed.push(target);
      n.mode = mode;
    },
    renameSync(from, to) {
      for (const k of [...tree.keys()]) {
        if (k === from || k.startsWith(from + "/")) {
          tree.set(to + k.slice(from.length), tree.get(k)!);
          tree.delete(k);
        }
      }
    },
    rmSync(target) {
      for (const k of [...tree.keys()]) if (k === target || k.startsWith(target + "/")) tree.delete(k);
    },
  };
  return { fs, tree, followed, add: (path, node) => void tree.set(path, { uid: 0, gid: 0, mode: 0o644, ...node }) };
}

const K = 20003;
const HOME = `/home/sandbox/owners/${K}`;

function oldHome(m: ReturnType<typeof memory>): void {
  m.add("/home/sandbox/owners", { kind: "dir", mode: 0o711 });
  m.add(HOME, { kind: "dir", uid: K, gid: 10001, mode: 0o700 });
  m.add(`${HOME}/tmp`, { kind: "dir", uid: K, gid: 10001, mode: 0o700 });
  m.add(`${HOME}/tmp/scratch.bin`, { kind: "file", uid: K, gid: 10001, mode: 0o644 });
  m.add(`${HOME}/.cache`, { kind: "dir", uid: K, gid: 10001, mode: 0o700 });
  m.add(`${HOME}/.cache/uv`, { kind: "dir", uid: K, gid: 10001, mode: 0o700 });
  m.add(`${HOME}/.cache/uv/wheel.whl`, { kind: "file", uid: K, gid: 10001, mode: 0o600 });
  m.add(`${HOME}/cells`, { kind: "dir", uid: K, gid: 10001, mode: 0o700 });
  m.add(`${HOME}/cells/deadbeef`, { kind: "dir", uid: K, gid: 10001, mode: 0o700 });
  m.add(`${HOME}/cells/deadbeef/files`, { kind: "dir", uid: K, gid: 10001, mode: 0o700 });
  m.add(`${HOME}/notes.txt`, { kind: "file", uid: K, gid: 10001, mode: 0o644 });
}

await check("an old home becomes root:K, owner bits copied to the group, nothing left for others", () => {
  const m = memory();
  oldHome(m);
  const report = migrateOwnerHomes(config, m.fs);
  assert.deepEqual(report.converted, [K]);
  assert.deepEqual(report.problems, []);
  for (const path of [HOME, `${HOME}/tmp`, `${HOME}/.cache/uv`, `${HOME}/.cache/uv/wheel.whl`, `${HOME}/tmp/scratch.bin`]) {
    const n = m.tree.get(path)!;
    assert.equal(n.uid, 0, `${path} uid`);
    assert.equal(n.gid, K, `${path} gid`);
    assert.equal(n.mode & 0o007, 0, `${path} still open to others`);
  }
  assert.equal(m.tree.get(`${HOME}/.cache/uv/wheel.whl`)!.mode, 0o660, "0600 file: the group gets rw");
  assert.equal(m.tree.get(`${HOME}/tmp`)!.mode, 0o770, "0700 folder: the group gets rwx");
  assert.equal(m.tree.get(`${HOME}/tmp/scratch.bin`)!.mode, 0o664 & ~0o004, "0644 file keeps rw for owner and group, others closed");
});

await check("what the cache held is still there (converted, not thrown away), and loose files move into home/", () => {
  const m = memory();
  oldHome(m);
  migrateOwnerHomes(config, m.fs);
  assert.ok(m.tree.has(`${HOME}/.cache/uv/wheel.whl`));
  assert.ok(m.tree.has(`${HOME}/tmp/scratch.bin`));
  assert.ok(!m.tree.has(`${HOME}/notes.txt`));
  assert.ok(m.tree.has(`${HOME}/home/notes.txt`));
  assert.equal(m.tree.get(`${HOME}/home`)!.uid, 0);
});

await check("folders of processes the last engine did not remove are cleared", () => {
  const m = memory();
  oldHome(m);
  const report = migrateOwnerHomes(config, m.fs);
  assert.equal(report.clearedProcessFolders, 1);
  assert.ok(m.tree.has(`${HOME}/cells`));
  assert.ok(!m.tree.has(`${HOME}/cells/deadbeef`));
  // A home that was already converted is cleared too, and not converted again.
  m.add(`${HOME}/cells/cafe`, { kind: "dir", uid: 20999, gid: K, mode: 0o700 });
  const again = migrateOwnerHomes(config, m.fs);
  assert.deepEqual(again.converted, []);
  assert.equal(again.clearedProcessFolders, 1);
});

await check("a symlink is re-owned as a link and its target is never touched", () => {
  const m = memory();
  oldHome(m);
  m.add("/app/src", { kind: "dir", uid: 0, gid: 0, mode: 0o755 });
  m.add(`${HOME}/tmp/evil`, { kind: "symlink", uid: K, gid: 10001, mode: 0o777 });
  migrateOwnerHomes(config, m.fs);
  assert.deepEqual(m.followed, [], "chmod was applied to a symlink");
  assert.equal(m.tree.get("/app/src")!.uid, 0);
  assert.equal(m.tree.get("/app/src")!.mode, 0o755);
  assert.equal(m.tree.get(`${HOME}/tmp/evil`)!.uid, 0);
});

await check("only what belongs to the old uid is re-owned: a root file a cell hard-linked in is left alone", () => {
  const m = memory();
  oldHome(m);
  m.add(`${HOME}/tmp/rootfile`, { kind: "file", uid: 0, gid: 0, mode: 0o600 });
  migrateOwnerHomes(config, m.fs);
  const n = m.tree.get(`${HOME}/tmp/rootfile`)!;
  assert.deepEqual({ uid: n.uid, gid: n.gid, mode: n.mode }, { uid: 0, gid: 0, mode: 0o600 });
});

await check("the top folder is changed last, so a crash half way is finished by the next start", () => {
  const m = memory();
  oldHome(m);
  const order: string[] = [];
  const realChown = m.fs.lchownSync;
  m.fs.lchownSync = (target, uid, gid) => {
    order.push(target);
    realChown(target, uid, gid);
  };
  migrateOwnerHomes(config, m.fs);
  assert.ok(order.indexOf(HOME) > order.indexOf(`${HOME}/.cache/uv/wheel.whl`));
  assert.ok(order.indexOf(`${HOME}/tmp`) < order.indexOf(HOME));
});

await check("a home that is not the old uid's, or is a symlink, is reported and left alone", () => {
  const m = memory();
  m.add("/home/sandbox/owners", { kind: "dir", mode: 0o711 });
  m.add("/home/sandbox/owners/20010", { kind: "dir", uid: 31337, gid: 10001, mode: 0o700 });
  m.add("/home/sandbox/owners/20011", { kind: "symlink", uid: 0, gid: 0, mode: 0o777 });
  const report = migrateOwnerHomes(config, m.fs);
  assert.deepEqual(report.converted, []);
  assert.equal(report.problems.length, 2);
  assert.match(report.problems.join("\n"), /20010 belongs to uid 31337/);
  assert.equal(m.tree.get("/home/sandbox/owners/20010")!.uid, 31337, "the folder was changed anyway");
});

await check("nothing to migrate when no one has run here", () => {
  const empty: MigrationFs = { ...memory().fs, readdirSync: () => { throw new Error("ENOENT"); } };
  assert.deepEqual(migrateOwnerHomes(config, empty), { converted: [], problems: [], clearedProcessFolders: 0 });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

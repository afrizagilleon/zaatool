/**
 * The sandbox against a real kernel: one uid per cell process, one gid per owner, root's
 * folders that a cell cannot replace, the OOM guard, and the sweep. Linux, as root, with the
 * SANDBOX_* variables the image sets (and `--cap-add SYS_RESOURCE` for the OOM checks); anywhere
 * else it says so and passes, because nothing here can be shown without a second uid.
 *
 *   docker run --rm --cap-add SYS_RESOURCE <image> pnpm exec tsx tests/sandbox-linux-root.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runJsNode } from "../src/core/js-runner.js";
import { runPythonNode } from "../src/core/python-runner.js";
import { createCellHost } from "../src/core/cell-workspace.js";
import { migrateOwnerHomes } from "../src/core/owner-home-migration.js";
import { readSandboxConfig } from "../src/core/sandbox-identity.js";

const config = readSandboxConfig(process.env);
if (process.platform !== "linux" || process.getuid?.() !== 0 || !config) {
  console.log("sandbox-linux-root: needs Linux, root and SANDBOX_GID; skipped.");
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const GID_A = config.uidBase + 100;
const GID_B = config.uidBase + 101;
const host = (gid = GID_A) => createCellHost({ sandbox: { config, gid } });
type Out = Record<string, unknown>;

const py = async (code: string, gid = GID_A, secrets: Record<string, string> = {}, ms = 20000, onLog?: (l: string, m: string) => void) => {
  const r = await runPythonNode(code, {}, ms, onLog, secrets, [], undefined, undefined, [], undefined, host(gid));
  assert.equal(r.error, undefined, r.error);
  return r.output as Out;
};
const js = async (code: string, gid = GID_A, ms = 20000) => {
  const r = await runJsNode(code, {}, ms, undefined, {}, [], undefined, undefined, [], undefined, host(gid));
  assert.equal(r.error, undefined, r.error);
  return r.output as Out;
};

const poll = async (what: () => boolean, ms = 8000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (what()) return true;
    await sleep(100);
  }
  return what();
};

console.log("\none uid per process, one gid per owner");

await check("every process has its own uid in the range, its owner's gid, and no other group", async () => {
  const [a, b] = await Promise.all([
    py("import os\nreturn {'uid': os.getuid(), 'gid': os.getgid(), 'groups': os.getgroups(), 'euid': os.geteuid()}"),
    py("import os\nreturn {'uid': os.getuid(), 'gid': os.getgid(), 'groups': os.getgroups()}"),
  ]);
  assert.notEqual(a.uid, b.uid, "two processes of one owner shared a uid");
  for (const r of [a, b]) {
    assert.ok((r.uid as number) >= config.uidBase && (r.uid as number) < config.uidBase + config.uidCount);
    assert.equal(r.gid, GID_A);
    assert.deepEqual(r.groups, []);
  }
  const other = await py("import os\nreturn {'gid': os.getgid()}", GID_B);
  assert.equal(other.gid, GID_B);
});

await check("a uid is not reused straight away: sequential cells walk through the range", async () => {
  const uids: number[] = [];
  for (let i = 0; i < 4; i += 1) uids.push((await py("import os\nreturn {'u': os.getuid()}")).u as number);
  assert.equal(new Set(uids).size, 4, `uids repeated: ${uids.join(",")}`);
});

await check("USER and LOGNAME are set, so getpass and friends work for a uid with no passwd entry", async () => {
  const r = await py("import getpass, os\nreturn {'user': getpass.getuser(), 'logname': os.environ.get('LOGNAME'), 'home': os.environ['HOME']}");
  assert.equal(r.user, "sandbox");
  assert.equal(r.home, `${config.home}/owners/${GID_A}/home`);
});

console.log("\ntwo cells of the same owner cannot touch each other");

await check("kill, /proc/<pid>/environ, mem and ptrace of a running sibling are all refused", async () => {
  let victimPid = 0;
  const victim = runPythonNode(
    "import os, time\nprint('PID', os.getpid(), flush=True)\ntime.sleep(6)\nreturn {'alive': True}",
    {}, 15000, (_l, m) => { if (m.startsWith("PID ")) victimPid = Number(m.slice(4)); },
    { ZZ_SECRET: "zz-secret-of-the-victim" }, [], undefined, undefined, [], undefined, host()
  );
  assert.ok(await poll(() => victimPid > 0), "the victim did not start");
  const attacker = await py(`import os, signal, ctypes
pid = ${victimPid}
def tried(fn):
    try: fn(); return "ALLOWED"
    except Exception as e: return type(e).__name__
out = {}
out["kill"] = tried(lambda: os.kill(pid, signal.SIGKILL))
out["environ"] = tried(lambda: open(f"/proc/{pid}/environ", "rb").read())
out["mem"] = tried(lambda: open(f"/proc/{pid}/mem", "rb").read(1))
out["maps"] = tried(lambda: open(f"/proc/{pid}/maps").read())
out["cwd"] = tried(lambda: os.readlink(f"/proc/{pid}/cwd"))
libc = ctypes.CDLL(None, use_errno=True)
out["ptrace"] = "ALLOWED" if libc.ptrace(16, pid, 0, 0) == 0 else "EPERM" if ctypes.get_errno() in (1, 13) else ctypes.get_errno()
hits = []
import glob
for p in glob.glob("/proc/[0-9]*/environ"):
    try:
        if b"zz-secret-of-the-victim" in open(p, "rb").read(): hits.append(p)
    except Exception: pass
out["secret_hits"] = hits
return out`);
  for (const key of ["kill", "environ", "mem", "maps", "cwd"]) assert.notEqual(attacker[key], "ALLOWED", `${key} was allowed`);
  assert.equal(attacker.ptrace, "EPERM");
  assert.deepEqual(attacker.secret_hits, []);
  const survived = await victim;
  assert.deepEqual(survived.output, { alive: true }, "the sibling was killed");
});

await check("a cell of another owner cannot enter this owner's files either", async () => {
  await py("import os\nopen(os.environ['TMPDIR'] + '/owned-by-a.txt', 'w').write('a')\nreturn {}");
  const r = await py(
    `import os\nout = {}\ntry: out['read'] = open('${config.home}/owners/${GID_A}/tmp/owned-by-a.txt').read()\nexcept Exception as e: out['read'] = type(e).__name__\ntry: out['list'] = os.listdir('${config.home}/owners/${GID_A}')\nexcept Exception as e: out['list'] = type(e).__name__\nreturn out`,
    GID_B
  );
  assert.equal(r.read, "PermissionError");
  assert.equal(r.list, "PermissionError");
});

console.log("\nthe owner's files are shared between their cells");

await check("a file one cell writes in TMPDIR is readable, writable and replaceable by the owner's next cell", async () => {
  await py("import os\nopen(os.environ['TMPDIR'] + '/shared.txt', 'w').write('from the first')\nos.mkdir(os.environ['TMPDIR'] + '/d')\nopen(os.environ['TMPDIR'] + '/d/x', 'w').write('x')\nreturn {}");
  const r = await js("return {};");
  assert.ok(r);
  const second = await py(`import os
t = os.environ['TMPDIR']
out = {'read': open(t + '/shared.txt').read()}
open(t + '/shared.txt', 'a').write(' + second')
open(t + '/d/x', 'a').write('y')
os.rename(t + '/shared.txt', t + '/renamed.txt')
out['mode'] = oct(os.stat(t + '/renamed.txt').st_mode & 0o777)
out['group'] = os.stat(t + '/renamed.txt').st_gid
return out`);
  assert.equal(second.read, "from the first");
  assert.equal(second.mode, "0o660", "umask 007 was not applied");
  assert.equal(second.group, GID_A);
});

console.log("\nC-01: a cell cannot turn the engine's chown/chmod into a root primitive");

await check("replacing tmp / .cache / cells in the owner's folder is refused, and links planted inside never get followed", async () => {
  fs.mkdirSync("/app/packages/engine/zz-victim", { recursive: true });
  fs.writeFileSync("/app/packages/engine/zz-victim/rootonly.txt", "root secret");
  fs.chmodSync("/app/packages/engine/zz-victim", 0o755);
  fs.chmodSync("/app/packages/engine/zz-victim/rootonly.txt", 0o600);
  const before = fs.statSync("/app/packages/engine/zz-victim");
  try {
    const plant = await py(`import os
home = os.environ["HOME"].rsplit("/", 1)[0]
out = {}
for name in ("tmp", ".cache", "cells", "tmp.old"):
    try:
        os.rename(home + "/" + name, home + "/" + name + ".moved"); out[name] = "RENAMED"
    except Exception as e: out[name] = type(e).__name__
for where in (home + "/tmp/link", os.environ["HOME"] + "/link", home + "/.cache/uv/link"):
    try: os.symlink("/app/packages/engine/zz-victim", where); out[where.split("/")[-2] + "/link"] = "planted"
    except Exception as e: out[where] = type(e).__name__
try: os.rmdir(home + "/tmp"); out["rmdir_tmp"] = "REMOVED"
except Exception as e: out["rmdir_tmp"] = type(e).__name__
return out`);
    for (const name of ["tmp", ".cache", "cells", "tmp.old"]) assert.notEqual(plant[name], "RENAMED", `${name} could be moved`);
    assert.notEqual(plant.rmdir_tmp, "REMOVED");
    // The engine's next runs of that owner: prepareOwnerHome and a fresh process folder.
    for (let i = 0; i < 3; i += 1) await py("return {}");
    const after = fs.statSync("/app/packages/engine/zz-victim");
    assert.equal(after.uid, before.uid, "the victim folder changed owner");
    assert.equal(after.mode, before.mode, "the victim folder changed mode");
    assert.equal(fs.statSync("/app/packages/engine/zz-victim/rootonly.txt").uid, 0);
    const write = await py(`try:\n    open("/app/packages/engine/zz-victim/pwned.txt", "w").write("x"); r = "WROTE"\nexcept Exception as e: r = type(e).__name__\nreturn {"r": r}`);
    assert.equal(write.r, "PermissionError");
    const src = await py(`try:\n    open("/app/packages/engine/src/core/uid-sweep.ts", "a").write("//"); r = "WROTE"\nexcept Exception as e: r = type(e).__name__\nreturn {"r": r}`);
    assert.equal(src.r, "PermissionError", "a cell could write the engine's source");
  } finally {
    fs.rmSync("/app/packages/engine/zz-victim", { recursive: true, force: true });
    fs.rmSync(`${config.home}/owners/${GID_A}/tmp`, { recursive: true, force: true });
    fs.mkdirSync(`${config.home}/owners/${GID_A}/tmp`);
  }
});

await check("staging an input file and disposing never follow a symlink the cell planted in its own folder", async () => {
  const victimDir = "/app/packages/engine/zz-victim2";
  fs.mkdirSync(victimDir, { recursive: true });
  fs.writeFileSync(`${victimDir}/keep.txt`, "keep me");
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "zz-storage-"));
  fs.writeFileSync(path.join(storage, "a.txt"), "granted file");
  fs.chmodSync(storage, 0o755);
  try {
    const ws = createCellHost({ sandbox: { config, gid: GID_A }, storageDir: storage }).open();
    const { uid, gid } = ws.spawn.options as { uid: number; gid: number };
    // The cell, as its own uid, plants links in its folder: where the input folder goes, and a trap.
    const plant = spawnSync("/bin/sh", ["-c", `ln -s ${victimDir} ${ws.dir}/files; ln -s ${victimDir} ${ws.dir}/trap; mkdir ${ws.dir}/d; ln -s ${victimDir}/keep.txt ${ws.dir}/d/keep`], { uid, gid });
    assert.equal(plant.status, 0, String(plant.stderr));
    // Root would have written 1-a.txt into the victim folder (copyFile follows the link). The helper is the cell's uid, which may not.
    assert.throws(() => ws.stageFrom({ path: "a.txt" }));
    assert.ok(!fs.existsSync(`${victimDir}/1-a.txt`), "an input file was written through the cell's symlink");
    await ws.dispose();
    assert.ok(await poll(() => !fs.existsSync(ws.dir)), "the process folder was not removed");
    assert.equal(fs.readFileSync(`${victimDir}/keep.txt`, "utf8"), "keep me", "dispose removed through a link");
    assert.deepEqual(fs.readdirSync(victimDir), ["keep.txt"]);
    assert.equal(fs.statSync(victimDir).uid, 0);
  } finally {
    fs.rmSync(victimDir, { recursive: true, force: true });
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

await check("a granted file is staged by the process's uid, 0600, and the cell reads it", async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "zz-storage-"));
  fs.writeFileSync(path.join(storage, "a.txt"), "granted file");
  fs.writeFileSync(path.join(storage, "b.txt"), "second");
  fs.chmodSync(storage, 0o700);
  try {
    const ws = createCellHost({ sandbox: { config, gid: GID_A }, storageDir: storage }).open({ files: [{ path: "a.txt" }, { path: "b.txt" }] });
    const copy = ws.staged["a.txt"];
    const stat = fs.statSync(copy);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(stat.uid, ws.spawn.options.uid);
    assert.equal(fs.readFileSync(ws.staged["b.txt"], "utf8"), "second");
    await ws.dispose();
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

await check("the process folder is the process's own: a sibling cannot enter it", async () => {
  let dir = "";
  const run = runPythonNode(
    "import os, time\nprint('DIR', os.getcwd(), flush=True)\ntime.sleep(5)\nreturn {}",
    {}, 15000, (_l, m) => { if (m.startsWith("DIR ")) dir = m.slice(4); }, {}, [], undefined, undefined, [], undefined, host()
  );
  assert.ok(await poll(() => dir !== ""));
  const stat = fs.statSync(dir);
  assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(stat.gid, GID_A);
  const r = await py(`import os\ntry: os.listdir('${dir}'); r = 'LISTED'\nexcept Exception as e: r = type(e).__name__\nreturn {'r': r}`);
  assert.equal(r.r, "PermissionError");
  await run;
});

console.log("\nS-18: the code of a running cell is not on its command line");

await check("another uid reading /proc/<pid>/cmdline finds neither the code nor the wrapper", async () => {
  let victimPid = 0;
  const victim = runPythonNode(
    "import os, time\nSECRET_MARKER = 'zz-code-marker-18'\nprint('PID', os.getpid(), flush=True)\ntime.sleep(5)\nreturn {}",
    {}, 15000, (_l, m) => { if (m.startsWith("PID ")) victimPid = Number(m.slice(4)); }, {}, [], undefined, undefined, [], undefined, host(GID_B)
  );
  assert.ok(await poll(() => victimPid > 0));
  const r = await py(`import glob
cmd = open("/proc/${victimPid}/cmdline", "rb").read()
hits = []
for p in glob.glob("/proc/[0-9]*/cmdline"):
    try:
        if b"zz-code-marker-18" in open(p, "rb").read(): hits.append(p)
    except Exception: pass
return {"cmdline": cmd.decode(errors="replace").replace("\\0", " "), "hits": hits}`);
  assert.deepEqual(r.hits, [], `the code was found in ${r.hits}`);
  assert.ok(!String(r.cmdline).includes("SECRET_MARKER") && !String(r.cmdline).includes("import json"), String(r.cmdline).slice(0, 200));
  await victim;
});

console.log("\nS-17: the kernel kills a cell before it kills the engine");

await check("a cell's oom_score_adj is 1000 from the start and it cannot lower it", async () => {
  const r = await py(`def rd(): return open("/proc/self/oom_score_adj").read().strip()
out = {"initial": rd()}
for v in (0, 500, -1):
    try:
        with open("/proc/self/oom_score_adj", "w") as f: f.write(str(v))
        out["lowered_to_%d" % v] = "ALLOWED"
    except Exception as e: out["lowered_to_%d" % v] = type(e).__name__
out["after"] = rd()
return out`);
  assert.equal(r.initial, "1000", "the guard was not in place before the cell started (needs --cap-add SYS_RESOURCE)");
  assert.equal(r.after, "1000");
  assert.ok(Object.entries(r).filter(([k]) => k.startsWith("lowered")).every(([, v]) => v !== "ALLOWED"));
});

console.log("\nthe sweep: nothing of a cell survives it");

await check("a setsid daemon a cell leaves behind is killed, and the uid's /dev/shm files go", async () => {
  const marker = `zz-daemon-${Date.now()}`;
  const r = await py(`import os, subprocess, sys, time
subprocess.Popen([sys.executable, "-c", "import time, sys\\nsys.argv[0] = '${marker}'\\ntime.sleep(300)", "${marker}"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
open("/dev/shm/${marker}", "w").write("x")
return {"uid": os.getuid()}`);
  const alive = () => fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p)).some((p) => {
    try { return fs.readFileSync(`/proc/${p}/cmdline`, "utf8").includes(marker) && fs.statSync(`/proc/${p}`).uid === r.uid; } catch { return false; }
  });
  assert.ok(await poll(() => !alive(), 10000), "the daemon is still running");
  assert.ok(await poll(() => !fs.existsSync(`/dev/shm/${marker}`), 10000), "the /dev/shm file is still there");
});

console.log("\nmigration: an installation that ran one uid per owner");

await check("an old home (owned by uid K, 0700) is converted and the owner's cells can use what it held", async () => {
  const K = config.uidBase + 300;
  const home = `${config.home}/owners/${K}`;
  fs.mkdirSync(`${home}/.cache/uv`, { recursive: true });
  fs.mkdirSync(`${home}/tmp`, { recursive: true });
  fs.mkdirSync(`${home}/cells/dead`, { recursive: true });
  fs.writeFileSync(`${home}/.cache/uv/wheel.whl`, "cached");
  fs.writeFileSync(`${home}/notes.txt`, "old home file");
  fs.symlinkSync("/etc/passwd", `${home}/tmp/evil`);
  for (const p of [home, `${home}/.cache`, `${home}/.cache/uv`, `${home}/tmp`, `${home}/cells`, `${home}/cells/dead`]) { fs.chownSync(p, K, 10001); fs.chmodSync(p, 0o700); }
  fs.chownSync(`${home}/.cache/uv/wheel.whl`, K, 10001);
  fs.chmodSync(`${home}/.cache/uv/wheel.whl`, 0o600);
  fs.chownSync(`${home}/notes.txt`, K, 10001);
  fs.lchownSync(`${home}/tmp/evil`, K, 10001);
  const passwdBefore = fs.statSync("/etc/passwd");

  const report = migrateOwnerHomes(config);
  assert.ok(report.converted.includes(K), JSON.stringify(report));
  assert.deepEqual(report.problems, []);
  assert.equal(fs.statSync(home).uid, 0);
  assert.equal(fs.statSync(home).gid, K);
  assert.ok(!fs.existsSync(`${home}/cells/dead`), "the dead process folder was not cleared");
  const passwdAfter = fs.statSync("/etc/passwd");
  assert.equal(passwdAfter.mode, passwdBefore.mode, "a symlink was followed");

  const r = await py(
    `import os\nh = os.environ['HOME']\nt = os.environ['TMPDIR']\nout = {'cache': open(os.environ['UV_CACHE_DIR'] + '/wheel.whl').read(), 'notes': open(h + '/notes.txt').read()}\nopen(os.environ['UV_CACHE_DIR'] + '/new.whl', 'w').write('x')\nreturn out`,
    K
  );
  assert.deepEqual(r, { cache: "cached", notes: "old home file" });
  fs.rmSync(home, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

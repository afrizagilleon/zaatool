import assert from "node:assert/strict";
import {
  cellSpawnIdentity,
  sandboxProblems,
  sandboxWarnings,
} from "../src/core/sandbox-identity.js";
import { cellIdentity, configProblems, sandboxIdentity } from "../src/config.js";

/**
 * K-02 part 2: cells run as an unprivileged user on Linux.
 *
 * The switch itself (`spawn` with `uid`/`gid`) needs Linux and root and is not exercised
 * here. What is: the decision of when and how to switch, and the startup checks around it,
 * as pure functions of platform, environment and `getuid`.
 */
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

const root = () => 0;
const nonRoot = () => 1000;
const set = { SANDBOX_UID: "10001", SANDBOX_GID: "10001" };

console.log("\nsandbox-identity (the spawn decision)");

await check("linux + ids set + root: uid, gid and a home for HOME, TMPDIR and uv", () => {
  const got = cellSpawnIdentity("linux", set, root);
  assert.deepEqual(got.options, { uid: 10001, gid: 10001 });
  assert.deepEqual(got.env, {
    HOME: "/home/sandbox",
    TMPDIR: "/home/sandbox/tmp",
    UV_CACHE_DIR: "/home/sandbox/.cache/uv",
  });
});

await check("SANDBOX_HOME moves all three", () => {
  const got = cellSpawnIdentity("linux", { ...set, SANDBOX_HOME: "/srv/cells" }, root);
  assert.equal(got.env.HOME, "/srv/cells");
  assert.equal(got.env.TMPDIR, "/srv/cells/tmp");
  assert.equal(got.env.UV_CACHE_DIR, "/srv/cells/.cache/uv");
});

await check("linux + ids unset: nothing", () => {
  assert.deepEqual(cellSpawnIdentity("linux", {}, root), { options: {}, env: {} });
});

await check("linux + only one id set: nothing", () => {
  assert.deepEqual(cellSpawnIdentity("linux", { SANDBOX_UID: "10001" }, root), { options: {}, env: {} });
});

await check("linux + ids set + not root: nothing (the engine cannot switch)", () => {
  assert.deepEqual(cellSpawnIdentity("linux", set, nonRoot), { options: {}, env: {} });
});

await check("win32: nothing, whatever is set", () => {
  assert.deepEqual(cellSpawnIdentity("win32", set, root), { options: {}, env: {} });
});

console.log("\nsandbox-identity (startup checks)");

await check("linux + set + root: no problem", () => {
  assert.deepEqual(sandboxProblems("linux", set, root), []);
});

await check("linux + set + non-root: refuses, and says why", () => {
  const problems = sandboxProblems("linux", set, nonRoot);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not running as root/);
});

await check("linux + unset: no problem", () => {
  assert.deepEqual(sandboxProblems("linux", {}, nonRoot), []);
});

await check("linux + a half-set or non-numeric pair is a problem", () => {
  assert.equal(sandboxProblems("linux", { SANDBOX_UID: "10001" }, root).length, 1);
  assert.equal(sandboxProblems("linux", { SANDBOX_UID: "sandbox", SANDBOX_GID: "1" }, root).length, 1);
});

await check("linux + uid 0 is a problem: that is root", () => {
  assert.equal(sandboxProblems("linux", { SANDBOX_UID: "0", SANDBOX_GID: "0" }, root).length, 1);
});

await check("win32: no problem, one warning that it is ignored", () => {
  assert.deepEqual(sandboxProblems("win32", set, nonRoot), []);
  assert.equal(sandboxWarnings("win32", set).length, 1);
  assert.deepEqual(sandboxWarnings("win32", {}), []);
  assert.deepEqual(sandboxWarnings("linux", set), []);
});

console.log("\nsandbox-identity (config wiring, on this platform)");

await check("configProblems and cellIdentity read the environment at call time", () => {
  const old = { uid: process.env.SANDBOX_UID, gid: process.env.SANDBOX_GID };
  try {
    delete process.env.SANDBOX_UID;
    delete process.env.SANDBOX_GID;
    assert.equal(sandboxIdentity(), undefined);

    process.env.SANDBOX_UID = "10001";
    process.env.SANDBOX_GID = "10001";
    assert.deepEqual(sandboxIdentity(), { uid: 10001, gid: 10001, home: "/home/sandbox" });

    const isRoot = process.platform !== "win32" && process.getuid?.() === 0;
    if (process.platform === "win32") {
      assert.deepEqual(configProblems(), []);
      assert.deepEqual(cellIdentity(), { options: {}, env: {} });
    } else if (isRoot) {
      assert.deepEqual(cellIdentity().options, { uid: 10001, gid: 10001 });
    } else {
      assert.equal(configProblems().length, 1);
    }
  } finally {
    if (old.uid === undefined) delete process.env.SANDBOX_UID;
    else process.env.SANDBOX_UID = old.uid;
    if (old.gid === undefined) delete process.env.SANDBOX_GID;
    else process.env.SANDBOX_GID = old.gid;
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

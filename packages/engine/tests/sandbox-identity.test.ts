import assert from "node:assert/strict";
import {
  activeSandbox,
  ownerHomePath,
  ownerSpawnIdentity,
  readSandboxConfig,
  sandboxProblems,
  sandboxWarnings,
} from "../src/core/sandbox-identity.js";
import { activeSandboxConfig, configProblems } from "../src/config.js";

/**
 * K-02 part 2 and FX-20: cells run as an unprivileged user on Linux, one per owner.
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
const set = { SANDBOX_GID: "10001" };

console.log("\nsandbox-identity (the spawn decision)");

await check("linux + gid set + root: the range has defaults, the owner's uid and home come from it", () => {
  const config = activeSandbox("linux", set, root)!;
  assert.deepEqual(config, { uidBase: 20000, uidCount: 40000, gid: 10001, home: "/home/sandbox" });
  const got = ownerSpawnIdentity(config, 20003);
  assert.deepEqual(got.options, { uid: 20003, gid: 10001 });
  assert.deepEqual(got.env, {
    HOME: "/home/sandbox/owners/20003",
    TMPDIR: "/home/sandbox/owners/20003/tmp",
    UV_CACHE_DIR: "/home/sandbox/owners/20003/.cache/uv",
  });
});

await check("two owners get two different homes", () => {
  const config = readSandboxConfig(set)!;
  assert.notEqual(ownerHomePath(config, 20000), ownerHomePath(config, 20001));
});

await check("SANDBOX_HOME, SANDBOX_UID_BASE and SANDBOX_UID_COUNT move the range and the home", () => {
  const config = readSandboxConfig({
    ...set,
    SANDBOX_HOME: "/srv/cells",
    SANDBOX_UID_BASE: "50000",
    SANDBOX_UID_COUNT: "10",
  })!;
  assert.equal(ownerHomePath(config, 50009), "/srv/cells/owners/50009");
  assert.equal(ownerSpawnIdentity(config, 50009).options.uid, 50009);
});

await check("a uid outside the range is refused rather than used", () => {
  const config = readSandboxConfig({ ...set, SANDBOX_UID_COUNT: "10" })!;
  assert.throws(() => ownerSpawnIdentity(config, 20010), /outside 20000\.\.20009/);
  assert.throws(() => ownerSpawnIdentity(config, 0), /outside/);
});

await check("linux + gid unset: nothing", () => {
  assert.equal(activeSandbox("linux", {}, root), undefined);
});

await check("linux + configured + not root: nothing (the engine cannot switch)", () => {
  assert.equal(activeSandbox("linux", set, nonRoot), undefined);
});

await check("win32: nothing, whatever is set", () => {
  assert.equal(activeSandbox("win32", set, root), undefined);
});

console.log("\nsandbox-identity (startup checks)");

await check("linux + set + root: no problem", () => {
  assert.deepEqual(sandboxProblems("linux", set, root), []);
  assert.deepEqual(sandboxProblems("linux", { ...set, SANDBOX_UID_BASE: "30000", SANDBOX_UID_COUNT: "5" }, root), []);
});

await check("linux + set + non-root: refuses, and says why", () => {
  const problems = sandboxProblems("linux", set, nonRoot);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not running as root/);
});

await check("linux + unset: no problem", () => {
  assert.deepEqual(sandboxProblems("linux", {}, nonRoot), []);
});

await check("the old SANDBOX_UID alone is refused with a migration message", () => {
  const problems = sandboxProblems("linux", { SANDBOX_UID: "10001", SANDBOX_GID: "10001" }, root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /SANDBOX_UID is no longer used/);
  assert.match(problems[0], /SANDBOX_UID_BASE/);
  assert.equal(sandboxProblems("linux", { SANDBOX_UID: "10001" }, root).length, 1);
});

await check("linux + a base or count without a gid, or non-numeric, is a problem", () => {
  assert.equal(sandboxProblems("linux", { SANDBOX_UID_BASE: "20000" }, root).length, 1);
  assert.equal(sandboxProblems("linux", { ...set, SANDBOX_UID_BASE: "owner" }, root).length, 1);
  assert.equal(sandboxProblems("linux", { ...set, SANDBOX_UID_COUNT: "0" }, root).length, 1);
});

await check("linux + uid 0 or gid 0 is a problem: that is root", () => {
  assert.equal(sandboxProblems("linux", { SANDBOX_GID: "0" }, root).length, 1);
  assert.equal(sandboxProblems("linux", { ...set, SANDBOX_UID_BASE: "0" }, root).length, 1);
});

await check("a range that runs past the highest Linux uid is a problem", () => {
  assert.equal(
    sandboxProblems("linux", { ...set, SANDBOX_UID_BASE: "4294960000", SANDBOX_UID_COUNT: "40000" }, root).length,
    1
  );
});

await check("win32: no problem, one warning that it is ignored", () => {
  assert.deepEqual(sandboxProblems("win32", set, nonRoot), []);
  assert.equal(sandboxWarnings("win32", set).length, 1);
  assert.deepEqual(sandboxWarnings("win32", {}), []);
  assert.deepEqual(sandboxWarnings("linux", set), []);
});

console.log("\nsandbox-identity (config wiring, on this platform)");

await check("configProblems and activeSandboxConfig read the environment at call time", () => {
  const old = { uid: process.env.SANDBOX_UID, gid: process.env.SANDBOX_GID };
  try {
    delete process.env.SANDBOX_UID;
    delete process.env.SANDBOX_GID;
    assert.equal(activeSandboxConfig(), undefined);

    process.env.SANDBOX_GID = "10001";
    const isRoot = process.platform !== "win32" && process.getuid?.() === 0;
    if (process.platform === "win32") {
      assert.deepEqual(configProblems(), []);
      assert.equal(activeSandboxConfig(), undefined);
    } else if (isRoot) {
      assert.equal(activeSandboxConfig()?.gid, 10001);
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

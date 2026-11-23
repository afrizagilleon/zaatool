/**
 * The pool of one-off uids: every cell process leases its own, a uid is not handed out again
 * before it has been swept, and a sweep that cannot be confirmed retires the uid rather than
 * risking it. Driven with a fake sweeper, so it needs neither Linux nor root. (That the real
 * sweep kills what a cell leaves behind is proven on Linux: tests/sandbox-linux-root.test.ts.)
 *
 *   pnpm --filter @zaa-tool/engine test uid-sweep
 */
import assert from "node:assert/strict";
import { createUidPool, SWEEP_SCRIPT, UidPoolExhaustedError, type SweepTarget } from "../src/core/uid-sweep.js";

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

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** A sweeper that records calls and ends only when told to. */
function fakeSweeper(result = true) {
  const calls: SweepTarget[] = [];
  const ends: Array<(clean: boolean) => void> = [];
  return {
    calls,
    finishNext: (clean = result) => ends.shift()?.(clean),
    sweeper: (t: SweepTarget) => {
      calls.push(t);
      return new Promise<boolean>((resolve) => ends.push(resolve));
    },
  };
}

const pool = (f: { sweeper: (t: SweepTarget) => Promise<boolean> }, count = 5, extra = {}) =>
  createUidPool({ base: 20000, count, sweeper: f.sweeper, start: 0, retryDelayMs: 0, onProblem: () => undefined, ...extra });

await check("every lease gets a uid of its own", () => {
  const p = pool(fakeSweeper());
  const uids = [p.lease(30000), p.lease(30000), p.lease(30001)].map((l) => l.uid);
  assert.equal(new Set(uids).size, 3);
  assert.ok(uids.every((uid) => uid >= 20000 && uid < 20005));
  assert.equal(p.inUse(), 3);
});

await check("the uid is swept, with its group and folder, when the process ends", async () => {
  const f = fakeSweeper();
  const p = pool(f);
  const lease = p.lease(30007);
  assert.deepEqual(f.calls, []);
  const released = lease.release("/home/sandbox/owners/30007/cells/abc");
  assert.deepEqual(f.calls, [{ uid: lease.uid, gid: 30007, dir: "/home/sandbox/owners/30007/cells/abc" }]);
  f.finishNext();
  await released;
});

await check("a uid is not reusable while its sweep runs, and is after it is confirmed", async () => {
  const f = fakeSweeper();
  const p = pool(f, 1);
  const lease = p.lease(30000);
  const released = lease.release();
  assert.throws(() => p.lease(30000), UidPoolExhaustedError, "handed out again before the sweep ended");
  f.finishNext(true);
  await released;
  assert.equal(p.lease(30000).uid, lease.uid);
});

await check("the next uid is the one after the last, so a uid does not come back until the range is used", async () => {
  const f = fakeSweeper();
  const p = pool(f, 4);
  const seen: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const lease = p.lease(30000);
    seen.push(lease.uid);
    const released = lease.release();
    f.finishNext();
    await released;
  }
  assert.deepEqual(seen, [20000, 20001, 20002, 20003, 20000, 20001, 20002, 20003]);
});

await check("a start offset wraps inside the range", () => {
  const p = createUidPool({ base: 20000, count: 3, sweeper: async () => true, start: 7 });
  assert.equal(p.lease(1).uid, 20001);
  assert.equal(p.lease(1).uid, 20002);
  assert.equal(p.lease(1).uid, 20000);
});

await check("an exhausted pool throws an error that names SANDBOX_UID_COUNT", () => {
  const p = pool(fakeSweeper(), 2);
  p.lease(30000);
  p.lease(30000);
  assert.throws(() => p.lease(30000), (err: unknown) => err instanceof UidPoolExhaustedError && /SANDBOX_UID_COUNT/.test(err.message));
});

await check("releasing twice sweeps once", async () => {
  const f = fakeSweeper();
  const p = pool(f);
  const lease = p.lease(30000);
  const a = lease.release();
  const b = lease.release();
  assert.equal(a, b);
  assert.equal(f.calls.length, 1);
  f.finishNext();
  await a;
});

await check("a sweep that is not confirmed is tried again, and a uid that never is is retired", async () => {
  const problems: string[] = [];
  const f = fakeSweeper(false);
  const p = pool(f, 2, { retries: 2, onProblem: (m: string) => problems.push(m) });
  const lease = p.lease(30000);
  const released = lease.release();
  for (let i = 0; i < 3; i += 1) {
    await tick();
    f.finishNext(false);
  }
  await released;
  assert.equal(f.calls.length, 3, "one sweep and two retries");
  assert.equal(p.retired(), 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(String(lease.uid)));
  // The retired uid is never handed out again; the other one is.
  const next = p.lease(30000);
  assert.notEqual(next.uid, lease.uid);
  assert.throws(() => p.lease(30000), UidPoolExhaustedError);
});

await check("a sweeper that throws counts as not confirmed, and does not wedge the pool", async () => {
  const p = createUidPool({
    base: 20000,
    count: 3,
    sweeper: () => Promise.reject(new Error("boom")),
    start: 0,
    retries: 0,
    onProblem: () => undefined,
  });
  const lease = p.lease(1);
  await lease.release();
  assert.equal(p.retired(), 1);
  assert.equal(p.lease(1).uid, 20001);
});

await check("a retry that succeeds frees the uid", async () => {
  let attempts = 0;
  const p = createUidPool({
    base: 20000,
    count: 1,
    sweeper: async () => (attempts += 1) >= 2,
    start: 0,
    retryDelayMs: 0,
    onProblem: () => undefined,
  });
  const lease = p.lease(1);
  await lease.release();
  assert.equal(p.retired(), 0);
  assert.equal(p.lease(1).uid, lease.uid);
});

await check("the sweep script kills as the uid, waits for it to be empty, and removes only what the uid owns", () => {
  assert.match(SWEEP_SCRIPT, /process\.kill\(-1, "SIGKILL"\)/);
  assert.match(SWEEP_SCRIPT, /\/dev\/shm/);
  assert.match(SWEEP_SCRIPT, /lstatSync\(shared \+ "\/" \+ name\)\.uid === me/);
  assert.doesNotMatch(SWEEP_SCRIPT, /recursive/, "it removes with its own walk, as the uid, not with a recursive rm");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

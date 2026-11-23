/**
 * The per-uid sweep: when an owner's last cell process ends, everything of that uid is
 * killed, and never while another process of the same owner is running or starting.
 * Driven with a fake sweeper, so it needs neither Linux nor root.
 *
 *   pnpm --filter @zaa-tool/engine test uid-sweep
 */
import assert from "node:assert/strict";
import { createUidLedger } from "../src/core/uid-sweep.js";

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
function fakeSweeper() {
  const calls: number[] = [];
  const ends: Array<() => void> = [];
  return {
    calls,
    finishNext: () => ends.shift()?.(),
    sweeper: (t: { uid: number }) => {
      calls.push(t.uid);
      return new Promise<void>((resolve) => ends.push(resolve));
    },
  };
}

await check("a lone process sweeps its uid when it ends", async () => {
  const f = fakeSweeper();
  const ledger = createUidLedger(f.sweeper);
  const release = await ledger.acquire({ uid: 20000, gid: 1 });
  assert.deepEqual(f.calls, []);
  release();
  assert.deepEqual(f.calls, [20000]);
  f.finishNext();
});

await check("no sweep while another process of the same owner still runs", async () => {
  const f = fakeSweeper();
  const ledger = createUidLedger(f.sweeper);
  const a = await ledger.acquire({ uid: 20000 });
  const b = await ledger.acquire({ uid: 20000 });
  a();
  assert.deepEqual(f.calls, [], "b is still running");
  b();
  assert.deepEqual(f.calls, [20000]);
  f.finishNext();
});

await check("another owner's processes do not hold the sweep back or get swept", async () => {
  const f = fakeSweeper();
  const ledger = createUidLedger(f.sweeper);
  const a = await ledger.acquire({ uid: 20000 });
  const other = await ledger.acquire({ uid: 20001 });
  a();
  assert.deepEqual(f.calls, [20000]);
  other();
  assert.deepEqual(f.calls, [20000, 20001]);
  f.finishNext();
  f.finishNext();
});

await check("a release is counted once", async () => {
  const f = fakeSweeper();
  const ledger = createUidLedger(f.sweeper);
  const a = await ledger.acquire({ uid: 20000 });
  const b = await ledger.acquire({ uid: 20000 });
  a();
  a();
  assert.deepEqual(f.calls, [], "the second call of a() must not count for b");
  b();
  assert.deepEqual(f.calls, [20000]);
  f.finishNext();
});

await check("a new process of the same owner waits for a running sweep", async () => {
  const f = fakeSweeper();
  const ledger = createUidLedger(f.sweeper);
  (await ledger.acquire({ uid: 20000 }))();
  let started = false;
  const next = ledger.acquire({ uid: 20000 }).then((release) => {
    started = true;
    return release;
  });
  await tick();
  assert.equal(started, false, "must not start while the sweep runs");
  f.finishNext();
  const release = await next;
  assert.equal(started, true);
  assert.deepEqual(f.calls, [20000], "the new process is not swept");
  release();
  assert.deepEqual(f.calls, [20000, 20000], "and it sweeps in its turn");
  f.finishNext();
});

await check("a process of another owner does not wait for the sweep", async () => {
  const f = fakeSweeper();
  const ledger = createUidLedger(f.sweeper);
  (await ledger.acquire({ uid: 20000 }))();
  const other = await ledger.acquire({ uid: 20001 });
  other();
  f.finishNext();
  f.finishNext();
});

await check("a sweeper that fails does not wedge the owner", async () => {
  const ledger = createUidLedger(() => Promise.reject(new Error("boom")));
  (await ledger.acquire({ uid: 20000 }))();
  const again = await ledger.acquire({ uid: 20000 });
  again();
});

await check("withLease holds the lease for the run, releases on failure, skips without a uid", async () => {
  const f = fakeSweeper();
  const ledger = createUidLedger(f.sweeper);
  await ledger.withLease({}, async () => undefined);
  await ledger.withLease({ uid: 0 }, async () => undefined);
  assert.deepEqual(f.calls, [], "no uid, or root: never a sweep");
  if (process.platform === "win32") {
    await ledger.withLease({ uid: 20000 }, async () => undefined);
    assert.deepEqual(f.calls, [], "never on Windows");
    return;
  }
  await assert.rejects(ledger.withLease({ uid: 20000 }, async () => Promise.reject(new Error("x"))));
  assert.deepEqual(f.calls, [20000]);
  f.finishNext();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

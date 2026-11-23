/**
 * The run gate on its own: reservations are taken in one step, one owner cannot fill the
 * gate, and a freed slot goes to the owners in turn (C-02, C-03).
 * Before: `isFull` and `acquire` were separate steps, so a burst saw an empty gate.
 *
 * No database and no files.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/run-gate.test.ts
 */
import assert from "node:assert/strict";
import { RunGate, type RunTicket } from "../src/core/run-gate.js";
import { makeCheck } from "./k10-helpers.js";

const { check, tally } = makeCheck();

const gate = (over: Partial<ConstructorParameters<typeof RunGate>[0]> = {}) =>
  new RunGate({
    maxConcurrent: 4,
    maxQueued: 20,
    maxQueuedScheduled: 100,
    maxPerOwner: 2,
    maxQueuedPerOwner: 10,
    ...over,
  });

const take = (g: RunGate, owner: string, scheduled = false): RunTicket => {
  const ticket = g.reserve(owner, scheduled);
  assert.ok(ticket, `${owner} was refused`);
  return ticket;
};

/** Whether the ticket holds a running slot right now. */
const running = async (t: RunTicket): Promise<boolean> =>
  Promise.race([t.ready.then(() => true), new Promise<boolean>((r) => setImmediate(() => r(false)))]);

console.log("\nrun gate");

await check("a burst in one tick is counted run by run (4 running + 20 queued, no more)", () => {
  const g = gate({ maxPerOwner: 4, maxQueuedPerOwner: 20 });
  const tickets = Array.from({ length: 150 }, (_, i) => g.reserve(`o${i % 7}`));
  assert.equal(tickets.filter(Boolean).length, 24);
  assert.deepEqual(g.stats, { active: 4, queued: 20 });
});

await check("one owner holds at most half the slots and half the queue", () => {
  const g = gate();
  const own = Array.from({ length: 40 }, () => g.reserve("a")).filter(Boolean);
  assert.equal(own.length, 12, "2 running + 10 queued");
  assert.deepEqual(g.stats, { active: 2, queued: 10 });
  assert.ok(g.reserve("b"), "another owner still has room");
});

await check("a release of a slot is handed on, and a released place in line frees room", async () => {
  const g = gate({ maxConcurrent: 1, maxPerOwner: 1, maxQueued: 2, maxQueuedPerOwner: 2 });
  const first = take(g, "a");
  const second = take(g, "a");
  const third = take(g, "a");
  assert.equal(g.reserve("a"), null, "full");
  assert.equal(await running(second), false);
  third.release();
  assert.ok(g.reserve("a"), "the abandoned place was given back");
  first.release();
  assert.equal(await running(second), true, "the next in line got the slot");
  first.release();
  assert.deepEqual(g.stats, { active: 1, queued: 1 }, "a second release of a ticket does nothing");
});

await check("a freed slot goes to the owners in turn", async () => {
  const g = gate({ maxConcurrent: 2, maxPerOwner: 2, maxQueued: 20, maxQueuedPerOwner: 20 });
  const a1 = take(g, "a");
  const a2 = take(g, "a");
  const aWait = Array.from({ length: 5 }, () => take(g, "a"));
  const bWait = Array.from({ length: 2 }, () => take(g, "b"));
  a1.release();
  assert.equal(await running(aWait[0]), true, "oldest first within the first owner served");
  a2.release();
  assert.equal(await running(bWait[0]), true, "then the other owner, not the same one again");
  assert.equal(await running(aWait[1]), false);
});

await check("a scheduled run may wait past where a webhook is refused, up to its own bound", () => {
  const g = gate({ maxPerOwner: 4, maxQueuedPerOwner: 20 });
  for (let i = 0; i < 24; i += 1) take(g, `o${i}`);
  assert.equal(g.reserve("x"), null);
  assert.ok(g.reserve("x", true));
});

console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
process.exit(tally.failed === 0 ? 0 : 1);

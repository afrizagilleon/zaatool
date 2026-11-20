/**
 * K-12 — cron is read in one configured time zone, matches standard cron, and fires each
 * wall-clock minute exactly once.
 *
 * The parser and matcher are pure. The tick logic is driven with injected clock values and
 * an injected trigger list, so nothing here waits for a real minute. Deploy validation goes
 * through the real service and database; notebooks it creates are prefixed `zz-k12-` and
 * removed at the start and at the end.
 *
 *   pnpm --filter @zaa-tool/engine test scheduler-cron
 */
import assert from "node:assert/strict";
import { cronProblem, matchCron } from "../src/core/cron.js";
import { configProblems } from "../src/config.js";
import { SchedulerService } from "../src/services/scheduler.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { TriggerRecord } from "../src/services/notebook-triggers.service.js";
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

const PREFIX = "zz-k12-";

async function cleanup(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE $1", [`${PREFIX}%`]);
  for (const row of rows) await notebooksService.delete(row.id).catch(() => {});
}

await initDb();
await cleanup();

const at = (iso: string): Date => new Date(iso);

console.log("\ntime zone");


await check("one instant is 07:00 in Asia/Jakarta and 00:00 in UTC", () => {
  const instant = at("2026-03-10T00:00:00Z");
  assert.equal(matchCron("0 7 * * *", instant, "Asia/Jakarta"), true);
  assert.equal(matchCron("0 7 * * *", instant, "UTC"), false);
  assert.equal(matchCron("0 0 * * *", instant, "Asia/Jakarta"), false);
});

await check("the day rolls over in the zone, not in UTC", () => {
  // 18:30 UTC on the 9th is 01:30 on the 10th in Jakarta.
  assert.equal(matchCron("30 1 10 * *", at("2026-03-09T18:30:00Z"), "Asia/Jakarta"), true);
  assert.equal(matchCron("30 1 10 * *", at("2026-03-09T18:30:00Z"), "UTC"), false);
});

await check("an invalid CRON_TZ is a startup problem; a valid one is not", () => {
  const before = process.env.CRON_TZ;
  try {
    process.env.CRON_TZ = "Mars/Olympus";
    assert.ok(configProblems().some((p) => p.includes("CRON_TZ")));
    process.env.CRON_TZ = "Asia/Jakarta";
    assert.ok(!configProblems().some((p) => p.includes("CRON_TZ")));
  } finally {
    if (before === undefined) delete process.env.CRON_TZ;
    else process.env.CRON_TZ = before;
  }
});

console.log("\nstandard cron semantics");

await check("day-of-month and day-of-week are ORed when both are restricted", () => {
  // 2026-03-10 is a Tuesday, the 10th: the weekday matches, the date does not.
  assert.equal(matchCron("0 0 15 * 2", at("2026-03-10T00:00:00Z"), "UTC"), true);
  // 2026-03-15 is a Sunday: the 15th matches though the weekday does not.
  assert.equal(matchCron("0 0 15 * 2", at("2026-03-15T00:00:00Z"), "UTC"), true);
  // 2026-03-11 is a Wednesday, the 11th: neither.
  assert.equal(matchCron("0 0 15 * 2", at("2026-03-11T00:00:00Z"), "UTC"), false);
});

await check("a single restricted day field is still ANDed with the wildcard", () => {
  assert.equal(matchCron("0 0 * * 2", at("2026-03-10T00:00:00Z"), "UTC"), true);
  assert.equal(matchCron("0 0 * * 2", at("2026-03-11T00:00:00Z"), "UTC"), false);
  assert.equal(matchCron("0 0 15 * *", at("2026-03-10T00:00:00Z"), "UTC"), false);
});

await check("day-of-week 7 is Sunday, like 0", () => {
  const sunday = at("2026-03-15T00:00:00Z");
  assert.equal(matchCron("0 0 * * 7", sunday, "UTC"), true);
  assert.equal(matchCron("0 0 * * 0", sunday, "UTC"), true);
  assert.equal(matchCron("0 0 * * 7", at("2026-03-16T00:00:00Z"), "UTC"), false);
});

await check("steps, ranges and lists", () => {
  const m = (cron: string, iso: string) => matchCron(cron, at(iso), "UTC");
  assert.equal(m("*/15 * * * *", "2026-03-10T05:45:00Z"), true);
  assert.equal(m("*/15 * * * *", "2026-03-10T05:50:00Z"), false);
  assert.equal(m("10-30/10 * * * *", "2026-03-10T05:20:00Z"), true);
  assert.equal(m("10-30/10 * * * *", "2026-03-10T05:25:00Z"), false);
  assert.equal(m("10-30/10 * * * *", "2026-03-10T05:40:00Z"), false);
  assert.equal(m("0 9-17 * * *", "2026-03-10T17:00:00Z"), true);
  assert.equal(m("0 9-17 * * *", "2026-03-10T18:00:00Z"), false);
  assert.equal(m("0,30 8,20 * * *", "2026-03-10T20:30:00Z"), true);
  assert.equal(m("0,30 8,20 * * *", "2026-03-10T20:15:00Z"), false);
  assert.equal(m("0 0 * 1-3,12 *", "2026-12-10T00:00:00Z"), true);
  assert.equal(m("0 0 * 1-3,12 *", "2026-06-10T00:00:00Z"), false);
});

await check("invalid expressions are rejected", () => {
  for (const bad of [
    "",
    "* * * *",
    "* * * * * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "* * 32 * *",
    "* * * 13 *",
    "* * * * 8",
    "5-1 * * * *",
    "*/0 * * * *",
    "5/10 * * * *",
    "a * * * *",
    "* * * JAN *",
    "* * * * MON",
    "1,,2 * * * *",
    "*/5/2 * * * *",
    "1-2-3 * * * *",
  ]) {
    assert.notEqual(cronProblem(bad), null, `"${bad}" was accepted`);
  }
  for (const good of ["* * * * *", "0 9 * * 1-5", "*/5 0-6/2 1,15 * 7"]) {
    assert.equal(cronProblem(good), null, `"${good}" was refused`);
  }
  assert.equal(matchCron("60 * * * *", at("2026-03-10T00:00:00Z"), "UTC"), false);
});

console.log("\neach minute fires once");

const MIN = 60_000;
const base = at("2026-03-10T10:00:00Z").getTime();
const everyMinute = {
  id: "t",
  notebook_id: "nb",
  kind: "cron",
  cron: "* * * * *",
  slug: null,
  secret_key: null,
  enabled: true,
} as TriggerRecord;

function firedAtOf(options: { input: Record<string, unknown> }): string {
  return (options.input as { trigger: { firedAt: string } }).trigger.firedAt;
}

function harness() {
  const fired: string[] = [];
  const scheduler = new SchedulerService({
    listCron: async () => [everyMinute],
    startRun: async (_id, _publish, options) => {
      fired.push(firedAtOf(options));
      return { runId: "r" };
    },
  });
  return { fired, scheduler };
}

const minuteIso = (offset: number): string => new Date(base + offset * MIN).toISOString();

await check("an on-time tick fires its minute; a duplicate tick in the same minute fires nothing", async () => {
  const { fired, scheduler } = harness();
  scheduler.begin(() => {}, new Date(base + 30_000));
  await scheduler.tick(new Date(base + MIN));
  await scheduler.tick(new Date(base + MIN + 10));
  await scheduler.tick(new Date(base + MIN + 59_000));
  assert.deepEqual(fired, [minuteIso(1)]);
});

await check("the minute the engine started in is not run", async () => {
  const { fired, scheduler } = harness();
  scheduler.begin(() => {}, new Date(base + 30_000));
  await scheduler.tick(new Date(base + 40_000));
  assert.deepEqual(fired, []);
});

await check("a late tick within 5 minutes fires each skipped minute once", async () => {
  const { fired, scheduler } = harness();
  scheduler.begin(() => {}, new Date(base));
  await scheduler.tick(new Date(base + MIN));
  await scheduler.tick(new Date(base + 4 * MIN + 2_000));
  await scheduler.tick(new Date(base + 4 * MIN + 3_000));
  assert.deepEqual(fired, [minuteIso(1), minuteIso(2), minuteIso(3), minuteIso(4)]);
});

await check("a gap of exactly 5 minutes is caught up; 6 is downtime and fires only the current minute", async () => {
  const five = harness();
  five.scheduler.begin(() => {}, new Date(base));
  await five.scheduler.tick(new Date(base + 5 * MIN));
  assert.equal(five.fired.length, 5);

  const six = harness();
  six.scheduler.begin(() => {}, new Date(base));
  const warn = console.warn;
  console.warn = () => {};
  try {
    await six.scheduler.tick(new Date(base + 6 * MIN));
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(six.fired, [minuteIso(6)]);
});

await check("a slow tick cannot make the next one repeat its minutes", async () => {
  const fired: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scheduler = new SchedulerService({
    listCron: async () => {
      await gate;
      return [everyMinute];
    },
    startRun: async (_id, _publish, options) => {
      fired.push(firedAtOf(options));
      return { runId: "r" };
    },
  });
  scheduler.begin(() => {}, new Date(base));
  const first = scheduler.tick(new Date(base + MIN));
  const second = scheduler.tick(new Date(base + MIN + 1_000));
  release();
  await first;
  await second;
  assert.deepEqual(fired, [minuteIso(1)]);
});

console.log("\ndeploy validation");

function doc(slug: string, cron: string): Omit<NotebookJson, "version"> {
  return {
    id: "",
    name: `${PREFIX}${slug}`,
    runtime: "node",
    triggers: [{ id: `${slug}-t`, kind: "cron", cron }],
    steps: [{ id: `${slug}-cell`, kind: "cell", code: "return {};" }],
  };
}

await check("deploy refuses an invalid cron with a message that names it, and accepts a valid one", async () => {
  const bad = await notebooksService.save({ version: "1.0", ...doc("bad", "61 * * * *") });
  await assert.rejects(
    () => notebooksService.deploy(bad.id, "test"),
    (err: Error) => err.name === "DeployRefusedError" && err.message.includes("61 * * * *")
  );
  const { rows } = await pool.query("SELECT deployed_version_id FROM notebooks WHERE id = $1", [bad.id]);
  assert.equal(rows[0].deployed_version_id, null, "a refused deploy still pinned a version");

  const good = await notebooksService.save({ version: "1.0", ...doc("good", "*/5 * * * 1-5") });
  await notebooksService.deploy(good.id, "test");
});

await cleanup();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

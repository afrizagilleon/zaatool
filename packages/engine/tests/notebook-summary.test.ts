/**
 * FX4 — what a list row knows without opening the notebook.
 *
 * The list used to know a name, a runtime and two timestamps. So *"which of my
 * twenty-nine notebooks is deployed"* could only be answered by opening twenty-nine
 * notebooks, and nobody ever did — the answer was simply unavailable. Sorting by "last
 * run" and filtering by "deployed" are impossible on data that is not there, so the fix
 * had to start in this query.
 *
 * Run against the real database rather than a stubbed pool. The claim being made is
 * about SQL — two lateral joins, an array aggregate, a boolean derived from a nullable
 * column — and SQL that is only reasoned about is SQL that has not been checked. A fake
 * pool would have happily returned whatever shape I said it should.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-summary.test.ts
 */
import assert from "node:assert/strict";
import { pool } from "../src/db/connection.js";
import { initDb } from "../src/db/initializer.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookTriggersService } from "../src/services/notebook-triggers.service.js";
import type { NotebookJson, NotebookSummary } from "@zaa-tool/shared";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => Promise<void>): Promise<void> {
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

/**
 * Named `zz-` on purpose: these are fixtures, and the list this milestone builds hides
 * `zz-` by default. Everything made here is removed at the end anyway.
 */
const PREFIX = "zz-fx4-";
const made: string[] = [];

async function make(name: string, over: Partial<NotebookJson> = {}): Promise<string> {
  const saved = await notebooksService.save({
    version: "1.0",
    id: "",
    name: PREFIX + name,
    runtime: "node",
    steps: [],
    ...over,
  } as NotebookJson);
  made.push(saved.id);
  return saved.id;
}

function find(rows: NotebookSummary[], name: string): NotebookSummary {
  const row = rows.find((item) => item.name === PREFIX + name);
  assert.ok(row, `no summary row for ${PREFIX + name}`);
  return row;
}

async function main(): Promise<void> {
  await initDb();

  await make("plain");
  const liveId = await make("live");
  const taggedId = await make("tagged", { tags: ["Finance", " finance ", "DAILY"] });
  await make("cron", {
    triggers: [{ id: "t1", kind: "cron", cron: "0 6 * * *", enabled: true }],
  });
  await make("cron-off", {
    triggers: [{ id: "t2", kind: "cron", cron: "0 6 * * *", enabled: false }],
  });

  await notebooksService.deploy(liveId, "test");

  // Two runs for one notebook, so "most recent" has something to be more recent than.
  await pool.query(
    `INSERT INTO notebook_runs (id, notebook_id, status, started_at)
     VALUES ($1, $2, 'success', NOW() - INTERVAL '2 hours'),
            ($3, $2, 'failed',  NOW() - INTERVAL '10 minutes')`,
    [`${PREFIX}run-old`, liveId, `${PREFIX}run-new`]
  );

  const rows = await notebooksService.getSummary();

  await check("a notebook that was never deployed says so", async () => {
    assert.equal(find(rows, "plain").deployed, false);
    assert.equal(find(rows, "plain").last_run_at, null);
    assert.equal(find(rows, "plain").last_run_status, null);
  });

  await check("a deployed notebook says so without loading its document", async () => {
    assert.equal(find(rows, "live").deployed, true);
  });

  await check("the last run is the most recent one, not the first found", async () => {
    // Both runs belong to the same notebook. A join without `ORDER BY … LIMIT 1` inside
    // the lateral would return whichever row Postgres reached first — and would also
    // return the notebook twice, silently doubling the list.
    const live = find(rows, "live");
    assert.equal(live.last_run_status, "failed");
    assert.ok(live.last_run_at, "expected a last-run timestamp");
    assert.ok(
      Date.now() - new Date(live.last_run_at).getTime() < 60 * 60 * 1000,
      "expected the ten-minute-old run, not the two-hour-old one"
    );
  });

  await check("one row per notebook, however much history it has", async () => {
    assert.equal(rows.filter((row) => row.id === liveId).length, 1);
  });

  await check("tags come back normalised, from the column rather than the document", async () => {
    assert.deepEqual(find(rows, "tagged").tags, ["finance", "daily"]);
  });

  await check("a notebook with no tags has an empty list, not null", async () => {
    // `null.includes(...)` in the browser is a blank page, not a missing filter.
    assert.deepEqual(find(rows, "plain").tags, []);
    assert.deepEqual(find(rows, "plain").trigger_kinds, []);
  });

  await check("trigger kinds say how a notebook starts", async () => {
    assert.deepEqual(find(rows, "cron").trigger_kinds, ["cron"]);
  });

  await check("a disabled trigger is not a way in", async () => {
    // It is in the table, and grouping a notebook under "On a schedule" when its
    // schedule is switched off is a list that lies about what is running.
    assert.deepEqual(find(rows, "cron-off").trigger_kinds, []);
  });

  await check("tags follow the document on save, including being removed", async () => {
    const document = await notebooksService.getById(taggedId);
    assert.ok(document);
    await notebooksService.save({
      ...(JSON.parse(document.document) as NotebookJson),
      tags: [],
    });

    const after = (await notebooksService.getSummary()).find((row) => row.id === taggedId);
    assert.deepEqual(after?.tags, []);
  });

  // Cleanup: fixtures made by a test are not fixtures anybody wants to keep.
  for (const id of made) {
    await notebookTriggersService.syncForNotebook(id, []);
    await pool.query("DELETE FROM notebook_runs WHERE notebook_id = $1", [id]);
    await pool.query("DELETE FROM notebook_versions WHERE notebook_id = $1", [id]);
    await pool.query("UPDATE notebooks SET deployed_version_id = NULL WHERE id = $1", [id]);
    await pool.query("DELETE FROM notebooks WHERE id = $1", [id]);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

void main();

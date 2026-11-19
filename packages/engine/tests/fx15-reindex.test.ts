/**
 * FX15 / T-02 — the trigger index is rebuilt from what is deployed, and says what changed.
 *
 * An installation upgraded from a version that indexed drafts has a table that disagrees
 * with its deployed versions. Each test makes the table dirty on purpose (raw SQL, because
 * the service no longer has a way to write a draft's triggers) and asks the rebuild to put
 * it right.
 *
 * Notebooks it creates are prefixed `zz-fx15-ri-`, their triggers `zz-fx15-ri-...`; all are
 * removed at the start and at the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx15-reindex
 */
import assert from "node:assert/strict";
import { notebooksService } from "../src/services/notebooks.service.js";
import {
  notebookTriggersService,
  type TriggerIndexChange,
} from "../src/services/notebook-triggers.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson } from "@zaa-tool/shared";

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

const PREFIX = "zz-fx15-ri-";

async function cleanup(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE $1", [`${PREFIX}%`]);
  for (const row of rows) await notebooksService.delete(row.id).catch(() => {});
  await pool.query("DELETE FROM notebook_triggers WHERE id LIKE $1", [`${PREFIX}%`]);
}

async function make(
  name: string,
  triggers: NotebookJson["triggers"],
  deploy: boolean
): Promise<string> {
  const { id } = await notebooksService.save({
    version: "1.0",
    id: "",
    name: PREFIX + name,
    runtime: "node",
    triggers,
    steps: [{ id: `${name}-cell`, kind: "cell", code: "return {};" }],
  });
  if (deploy) await notebooksService.deploy(id, "test");
  return id;
}

async function rowsOf(notebookId: string) {
  const { rows } = await pool.query(
    "SELECT id, kind, cron, slug, secret_key, enabled FROM notebook_triggers WHERE notebook_id = $1 ORDER BY id",
    [notebookId]
  );
  return rows;
}

function mine(changes: TriggerIndexChange[], ...notebookIds: string[]): TriggerIndexChange[] {
  return changes
    .filter((change) => notebookIds.includes(change.notebookId))
    .sort((a, b) => a.triggerId.localeCompare(b.triggerId));
}

await initDb();
await cleanup();

const deployedId = await make(
  "deployed",
  [
    { id: `${PREFIX}hook`, kind: "webhook", slug: `${PREFIX}slug-deployed-aaaaaaaa`, secretKey: "ZZ_FX15_RI" },
    { id: `${PREFIX}cron`, kind: "cron", cron: "0 6 * * *" },
  ],
  true
);
const draftOnlyId = await make(
  "draft-only",
  [{ id: `${PREFIX}draft-cron`, kind: "cron", cron: "* * * * *" }],
  false
);

console.log("\nrebuilding a dirty index");

await check("a clean index reports no change for these notebooks", async () => {
  const changes = await notebookTriggersService.rebuildTriggerIndex();
  assert.deepEqual(mine(changes, deployedId, draftOnlyId), []);
});

await check("a secret the deployed version has and the index lost is put back, and reported", async () => {
  await pool.query("UPDATE notebook_triggers SET secret_key = NULL WHERE id = $1", [`${PREFIX}hook`]);

  const changes = mine(await notebookTriggersService.rebuildTriggerIndex(), deployedId);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].change, "changed");
  assert.equal(changes[0].triggerId, `${PREFIX}hook`);
  assert.match(changes[0].detail, /secret none -> ZZ_FX15_RI/);

  const row = (await rowsOf(deployedId)).find((r) => r.id === `${PREFIX}hook`);
  assert.equal(row?.secret_key, "ZZ_FX15_RI");
});

await check("a trigger that only the draft declared is removed, and reported", async () => {
  await pool.query(
    `INSERT INTO notebook_triggers (id, notebook_id, kind, cron, enabled)
     VALUES ($1, $2, 'cron', '* * * * *', TRUE)`,
    [`${PREFIX}draft-cron`, draftOnlyId]
  );

  const changes = mine(await notebookTriggersService.rebuildTriggerIndex(), draftOnlyId);
  assert.deepEqual(
    changes.map((change) => [change.change, change.triggerId]),
    [["removed", `${PREFIX}draft-cron`]]
  );
  assert.deepEqual(await rowsOf(draftOnlyId), []);
});

await check("a deployed trigger missing from the index is added back, and reported", async () => {
  await pool.query("DELETE FROM notebook_triggers WHERE id = $1", [`${PREFIX}cron`]);

  const changes = mine(await notebookTriggersService.rebuildTriggerIndex(), deployedId);
  assert.deepEqual(
    changes.map((change) => [change.change, change.triggerId]),
    [["added", `${PREFIX}cron`]]
  );
  assert.equal((await rowsOf(deployedId)).length, 2);
});

await check("a trigger left behind by a notebook that is no longer deployed is removed", async () => {
  // Raw SQL, as an older version's undeploy would have left it.
  await pool.query("UPDATE notebooks SET deployed_version_id = NULL WHERE id = $1", [deployedId]);
  await pool.query(
    `INSERT INTO notebook_triggers (id, notebook_id, kind, cron, enabled)
     VALUES ($1, $2, 'cron', '0 6 * * *', TRUE) ON CONFLICT (id) DO NOTHING`,
    [`${PREFIX}cron`, deployedId]
  );

  const changes = mine(await notebookTriggersService.rebuildTriggerIndex(), deployedId);
  assert.ok(changes.length >= 1 && changes.every((change) => change.change === "removed"));
  assert.deepEqual(await rowsOf(deployedId), []);

  await notebooksService.deploy(deployedId, "test");
});

console.log("\nidempotence");

await check("running it twice in a row: the second call changes nothing at all", async () => {
  await pool.query("UPDATE notebook_triggers SET secret_key = NULL WHERE id = $1", [`${PREFIX}hook`]);
  const first = await notebookTriggersService.rebuildTriggerIndex();
  assert.ok(first.length >= 1, "the first call had something to fix");

  const second = await notebookTriggersService.rebuildTriggerIndex();
  assert.deepEqual(second, []);
});

console.log("\na collision");

await check("a trigger id used by two deployed notebooks is kept for the earlier one and the other reported", async () => {
  const laterId = await make(
    "later",
    [{ id: `${PREFIX}later-cron`, kind: "cron", cron: "5 * * * *" }],
    true
  );
  // Make the later notebook's deployed version claim the earlier notebook's trigger id,
  // which a deploy would refuse to write but an older index could have allowed.
  await pool.query(
    `UPDATE notebook_versions SET document = REPLACE(document, $1, $2)
     WHERE id = (SELECT deployed_version_id FROM notebooks WHERE id = $3)`,
    [`${PREFIX}later-cron`, `${PREFIX}cron`, laterId]
  );

  const changes = mine(await notebookTriggersService.rebuildTriggerIndex(), laterId, deployedId);
  const skipped = changes.filter((change) => change.change === "skipped");
  assert.equal(skipped.length, 1, JSON.stringify(changes));
  assert.equal(skipped[0].notebookId, laterId);
  assert.equal((await rowsOf(deployedId)).some((r) => r.id === `${PREFIX}cron`), true);
  assert.deepEqual(await rowsOf(laterId), []);
});

await cleanup();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

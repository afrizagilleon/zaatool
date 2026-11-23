/**
 * C-06 — a deploy is one step, whatever else is deploying at the same moment.
 *
 * Names, slugs and trigger ids are unique among *deployed* notebooks, and that used to be
 * checked by reading and then writing: two deploys that read at the same time both saw
 * "free". Every case below starts the deploys together and asserts on the state the
 * database is left in, not on which one happened to win.
 *
 * Everything it makes is prefixed `zz-w2dep-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test w2-deploy-atomic
 */
import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebooksService, DeployRefusedError } from "../src/services/notebooks.service.js";
import { dropOwner, testOwner } from "./owners.js";
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

await initDb();
const owner = (await testOwner("w2dep")).id;

async function clean(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-w2dep-%'");
  for (const row of rows) await notebooksService.delete(row.id).catch(() => undefined);
}
await clean();

const save = async (name: string, extra: Partial<NotebookJson> = {}): Promise<string> =>
  (
    await notebooksService.save(
      {
        version: "1.0",
        id: "",
        name,
        runtime: "node",
        steps: [{ id: "c1", kind: "cell", code: "return {};" }],
        ...extra,
      },
      "test",
      owner
    )
  ).id;

const settle = async (promises: Promise<unknown>[]) => Promise.allSettled(promises);

console.log("\nthe name a deployed notebook goes by");

await check("twelve notebooks with one name, deployed together: exactly one is deployed", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 12; i += 1) ids.push(await save("zz-w2dep-same-name"));
  const results = await settle(ids.map((id) => notebooksService.deploy(id, "test")));

  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results) {
    if (r.status === "rejected") {
      assert.ok(r.reason instanceof DeployRefusedError, `a refusal in a person's words, not: ${String(r.reason)}`);
      assert.doesNotMatch(String(r.reason.message), /duplicate key/i);
    }
  }
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM notebooks WHERE deployed_version_id IS NOT NULL AND name = 'zz-w2dep-same-name'"
  );
  assert.equal(rows[0].n, 1);
  assert.notEqual(await notebooksService.findDeployedByIdOrName("zz-w2dep-same-name", ids), "ambiguous");
});

await check("the database itself refuses a second deployed notebook under one name", async () => {
  const a = await save("zz-w2dep-index-a");
  const b = await save("zz-w2dep-index-b");
  await notebooksService.deploy(a, "test");
  await notebooksService.deploy(b, "test");
  await assert.rejects(
    pool.query("UPDATE notebooks SET deployed_name = 'zz-w2dep-index-a' WHERE id = $1", [b]),
    (err: { code?: string }) => err.code === "23505"
  );
});

console.log("\na deploy that fails leaves nothing behind");

await check("two notebooks claiming one webhook slug: the loser is refused and not half deployed", async () => {
  const slug = "zz-w2dep-slug-0123456789abcdef";
  const trigger = { kind: "webhook" as const, slug, enabled: true };
  const a = await save("zz-w2dep-slug-a", { triggers: [{ ...trigger, id: "zz-w2dep-t-a" }] });
  const b = await save("zz-w2dep-slug-b", { triggers: [{ ...trigger, id: "zz-w2dep-t-b" }] });
  const results = await settle([notebooksService.deploy(a, "test"), notebooksService.deploy(b, "test")]);

  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results[0].status === "rejected" ? a : b;
  const won = lost === a ? b : a;
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof DeployRefusedError, String(rejected.reason));
  assert.doesNotMatch(String(rejected.reason.message), /duplicate key/i);

  const { rows: state } = await pool.query(
    `SELECT id, deployed_version_id IS NOT NULL AS deployed,
            (SELECT count(*)::int FROM notebook_versions v WHERE v.notebook_id = n.id) AS versions,
            (SELECT count(*)::int FROM notebook_triggers t WHERE t.notebook_id = n.id) AS triggers
     FROM notebooks n WHERE id = ANY($1)`,
    [[a, b]]
  );
  const byId = Object.fromEntries(state.map((row) => [row.id, row]));
  assert.deepEqual(byId[lost], { id: lost, deployed: false, versions: 0, triggers: 0 }, "the loser left something behind");
  assert.deepEqual(byId[won], { id: won, deployed: true, versions: 1, triggers: 1 });
});

await check("eight deploys of one notebook at once all succeed and leave one trigger row", async () => {
  const id = await save("zz-w2dep-twice", {
    triggers: [{ id: "zz-w2dep-t-twice", kind: "webhook", slug: "zz-w2dep-twice-0123456789abcdef", enabled: true }],
  });
  const results = await settle(Array.from({ length: 8 }, () => notebooksService.deploy(id, "test")));
  const failures = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
  assert.deepEqual(failures, []);

  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM notebook_triggers WHERE notebook_id = $1) AS triggers,
            (SELECT count(*)::int FROM notebook_versions WHERE notebook_id = $1) AS versions,
            n.deployed_version_id IN (SELECT id FROM notebook_versions WHERE notebook_id = $1) AS pinned
     FROM notebooks n WHERE n.id = $1`,
    [id]
  );
  assert.deepEqual(rows[0], { triggers: 1, versions: 8, pinned: true });
});

await check("undeploying while a deploy is running ends in a state that agrees with itself", async () => {
  const id = await save("zz-w2dep-flip", {
    triggers: [{ id: "zz-w2dep-t-flip", kind: "webhook", slug: "zz-w2dep-flip-0123456789abcdef", enabled: true }],
  });
  await settle([
    notebooksService.deploy(id, "test"),
    notebooksService.undeploy(id),
    notebooksService.deploy(id, "test"),
    notebooksService.undeploy(id),
  ]);
  const { rows } = await pool.query(
    `SELECT n.deployed_version_id IS NOT NULL AS deployed, n.deployed_name,
            (SELECT count(*)::int FROM notebook_triggers WHERE notebook_id = $1) AS triggers
     FROM notebooks n WHERE n.id = $1`,
    [id]
  );
  // Deployed means a pinned version, a name and its trigger; not deployed means none of them.
  assert.equal(rows[0].deployed, rows[0].deployed_name !== null);
  assert.equal(rows[0].deployed ? 1 : 0, rows[0].triggers);
});

await clean();
await dropOwner("w2dep");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

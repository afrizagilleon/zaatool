/**
 * FX15 / T-01 — what is listening in production is decided by a deploy, not by a save.
 *
 * The index in `notebook_triggers` is what the scheduler and the webhook route read. Before
 * this milestone every save rewrote it from the draft, so an edit made at 2pm could drop a
 * webhook's secret or add a cron before anyone pressed Deploy. Each test here saves a
 * draft that disagrees with the deployed version and asks what the index (and the live
 * route) now believe.
 *
 * Notebooks it creates are prefixed `zz-fx15-trg-`, the secret `ZZ_FX15_TRG`; both are
 * removed at the start and at the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx15-triggers
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookTriggersService } from "../src/services/notebook-triggers.service.js";
import { secretsService } from "../src/services/secrets.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson } from "@zaa-tool/shared";
import { testOwner, dropOwner } from "./owners.js";

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

const PREFIX = "zz-fx15-trg-";
const SECRET_KEY = "ZZ_FX15_TRG";
const SECRET_VALUE = "zz-fx15-trg-secret-value";

async function cleanup(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE $1", [`${PREFIX}%`]);
  for (const row of rows) await notebooksService.delete(row.id).catch(() => {});
  await pool.query("DELETE FROM secrets WHERE key = $1", [SECRET_KEY]).catch(() => {});
}

await initDb();
const OWNER = (await testOwner("fx15triggers")).id;
await cleanup();
await secretsService.create(OWNER, SECRET_KEY, SECRET_VALUE, true);

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document }, "test", OWNER);
  return id;
}

function hook(slug: string, secret?: string): Promise<Response> {
  return fetch(`${base}/hooks/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === undefined ? {} : { "X-Webhook-Secret": secret }),
    },
    body: "{}",
  });
}

async function cronIdsOf(notebookId: string): Promise<string[]> {
  const all = await notebookTriggersService.listEnabledCron();
  return all
    .filter((row) => row.notebook_id === notebookId)
    .map((row) => row.id)
    .sort();
}

async function secretKeysOf(notebookId: string): Promise<(string | null)[]> {
  const { rows } = await pool.query(
    "SELECT secret_key FROM notebook_triggers WHERE notebook_id = $1",
    [notebookId]
  );
  return rows.map((row) => row.secret_key as string | null);
}

const guarded = (slug: string, secretKey?: string): Omit<NotebookJson, "version"> => ({
  id: "",
  name: `${PREFIX}${slug}`,
  runtime: "node",
  triggers: [{ id: `${slug}-t`, kind: "webhook", slug, ...(secretKey ? { secretKey } : {}) }],
  steps: [{ id: `${slug}-cell`, kind: "cell", code: "return {};" }],
});

console.log("\nsaving a draft does not move what is listening");

const SLUG_A = "zz-fx15-trg-slug-guarded-aaaaaa";
let guardedId = "";

await check("a deployed webhook with a secret refuses a request without it, and takes the right one", async () => {
  guardedId = await store(guarded(SLUG_A, SECRET_KEY));
  await notebooksService.deploy(guardedId, "test");

  assert.equal((await hook(SLUG_A)).status, 401);
  assert.equal((await hook(SLUG_A, "wrong")).status, 401);
  const ok = await hook(SLUG_A, SECRET_VALUE);
  assert.ok(ok.status === 200 || ok.status === 202, `the right secret got ${ok.status}`);
});

await check("removing the secret from the draft alone leaves the webhook guarded", async () => {
  await store({ ...guarded(SLUG_A), id: guardedId });

  assert.deepEqual(await secretKeysOf(guardedId), [SECRET_KEY], "the index followed the draft");
  assert.equal((await hook(SLUG_A)).status, 401, "the webhook opened up on a save");
  const ok = await hook(SLUG_A, SECRET_VALUE);
  assert.ok(ok.status === 200 || ok.status === 202, `the right secret got ${ok.status}`);
});

await check("a cron added to the draft is not scheduled until the notebook is deployed", async () => {
  const doc = (triggers: NotebookJson["triggers"]): Omit<NotebookJson, "version"> => ({
    id: "",
    name: `${PREFIX}cron`,
    runtime: "node",
    triggers,
    steps: [{ id: "c1", kind: "cell", code: "return {};" }],
  });
  const old = { id: "zz-fx15-trg-cron-old", kind: "cron" as const, cron: "0 6 * * *" };
  const fresh = { id: "zz-fx15-trg-cron-new", kind: "cron" as const, cron: "* * * * *" };

  const id = await store(doc([old]));
  assert.deepEqual(await cronIdsOf(id), [], "a never-deployed notebook is scheduled");
  await notebooksService.deploy(id, "test");
  assert.deepEqual(await cronIdsOf(id), [old.id]);

  await store({ ...doc([old, fresh]), id });
  assert.deepEqual(await cronIdsOf(id), [old.id], "the draft's cron is already scheduled");

  await notebooksService.deploy(id, "test");
  assert.deepEqual(await cronIdsOf(id), [fresh.id, old.id]);
});

await check("a webhook that only exists in a never-deployed draft answers 404", async () => {
  await store(guarded("zz-fx15-trg-slug-draft-only-bbbb"));
  assert.equal((await hook("zz-fx15-trg-slug-draft-only-bbbb")).status, 404);
});

console.log("\ndeploy, undeploy and delete move the index");

await check("deploying a changed draft rewrites the index from it", async () => {
  await store({ ...guarded(SLUG_A), id: guardedId });
  await notebooksService.deploy(guardedId, "test");
  assert.deepEqual(await secretKeysOf(guardedId), [null]);
  assert.equal((await hook(SLUG_A)).status, 202, "deployed without a secret, it is open");
});

await check("undeploying makes the webhook an unknown slug, not a refusal", async () => {
  await notebooksService.undeploy(guardedId);
  assert.equal((await hook(SLUG_A)).status, 404);
  assert.deepEqual(await secretKeysOf(guardedId), []);
});

await check("an undeployed notebook's cron is gone from the scheduler", async () => {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name = $1", [`${PREFIX}cron`]);
  const id = rows[0].id as string;
  assert.ok((await cronIdsOf(id)).length > 0);
  await notebooksService.undeploy(id);
  assert.deepEqual(await cronIdsOf(id), []);
});

await check("redeploying brings the triggers back", async () => {
  await notebooksService.deploy(guardedId, "test");
  assert.equal((await hook(SLUG_A)).status, 202);
});

await check("deleting a notebook empties its index rows", async () => {
  await notebooksService.delete(guardedId);
  assert.deepEqual(await secretKeysOf(guardedId), []);
});

await cleanup();
await dropOwner("fx15triggers");
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

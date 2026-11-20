/**
 * FX15 / T-05 (engine half) — the map draws the triggers production listens to.
 *
 * Triggers on the map come from the deployed version; a draft trigger that is not in it
 * (or differs) is still drawn, flagged `draft`, so nobody mistakes it for a running one.
 * The same rule is what the editor's trigger panel and the deploy review use, so the
 * shared predicate is checked here too.
 *
 * Notebooks it creates are prefixed `zz-fx15-mp-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx15-map
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { buildNotebookMap, renderNotebookMap } from "../src/core/notebook-map.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { authService } from "../src/services/auth.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import {
  isTriggerDeployed,
  isTriggerPending,
  type NotebookJson,
  type NotebookMap,
  type NotebookTrigger,
} from "@zaa-tool/shared";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
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

const doc = (id: string, triggers: NotebookTrigger[]): NotebookJson => ({
  version: "1.0",
  id,
  name: `nb-${id}`,
  runtime: "node",
  steps: [],
  triggers,
});

const cron = (id: string, expression: string, enabled?: boolean): NotebookTrigger => ({
  id,
  kind: "cron",
  cron: expression,
  ...(enabled === undefined ? {} : { enabled }),
});

const hook = (id: string, slug: string, secretKey?: string): NotebookTrigger => ({
  id,
  kind: "webhook",
  slug,
  ...(secretKey ? { secretKey } : {}),
});

console.log("\nwhich triggers count as active");

await check("a draft trigger identical to the deployed one is deployed, and not pending", () => {
  const live = [cron("t1", "0 6 * * *"), hook("t2", "slug-aaaa", "KEY")];
  assert.equal(isTriggerDeployed(cron("t1", "0 6 * * *"), live), true);
  assert.equal(isTriggerPending(cron("t1", "0 6 * * *"), live), false);
  assert.equal(isTriggerPending(hook("t2", "slug-aaaa", "KEY"), live), false);
});

await check("absent, or different in cron, slug or secretKey, is pending", () => {
  const live = [cron("t1", "0 6 * * *"), hook("t2", "slug-aaaa", "KEY")];
  assert.equal(isTriggerPending(cron("t9", "0 6 * * *"), live), true, "a new id");
  assert.equal(isTriggerPending(cron("t1", "0 7 * * *"), live), true, "another schedule");
  assert.equal(isTriggerPending(hook("t2", "slug-bbbb", "KEY"), live), true, "another slug");
  assert.equal(isTriggerPending(hook("t2", "slug-aaaa"), live), true, "the secret was removed");
  assert.equal(isTriggerPending(hook("t2", "slug-aaaa", "OTHER"), live), true, "another secret");
});

await check("with nothing deployed every enabled trigger is pending, and a disabled one is not", () => {
  assert.equal(isTriggerPending(cron("t1", "0 6 * * *"), null), true);
  assert.equal(isTriggerPending(cron("t1", "0 6 * * *"), undefined), true);
  assert.equal(isTriggerPending(cron("t1", "0 6 * * *", false), null), false);
});

console.log("\nwhat the map draws");

await check("triggers are read from the deployed version, not the draft", () => {
  const map = buildNotebookMap([
    {
      document: doc("a", [cron("t1", "0 7 * * *")]),
      deployedDocument: doc("a", [cron("t1", "0 6 * * *")]),
      updatedAt: "2026-11-19T00:00:00.000Z",
      deployed: true,
    },
  ]);

  const live = map.triggers.find((trigger) => trigger.draft !== true);
  assert.equal(live?.label, "0 6 * * *", "the active trigger is the deployed schedule");
  const draft = map.triggers.find((trigger) => trigger.draft === true);
  assert.equal(draft?.label, "0 7 * * *");
  assert.notEqual(draft?.id, live?.id, "two map elements would share one id");
});

await check("a draft that matches the deployed version adds nothing", () => {
  const map = buildNotebookMap([
    {
      document: doc("a", [cron("t1", "0 6 * * *")]),
      deployedDocument: doc("a", [cron("t1", "0 6 * * *")]),
      updatedAt: "2026-11-19T00:00:00.000Z",
      deployed: true,
    },
  ]);
  assert.equal(map.triggers.length, 1);
  assert.equal(map.triggers[0].draft, undefined);
});

await check("a trigger only the draft has is drawn, flagged as a draft", () => {
  const map = buildNotebookMap([
    {
      document: doc("a", [hook("t1", "only-in-the-draft")]),
      deployedDocument: null,
      updatedAt: "2026-11-19T00:00:00.000Z",
      deployed: false,
    },
  ]);
  assert.deepEqual(
    map.triggers.map((trigger) => [trigger.label, trigger.draft]),
    [["/hooks/only-in-the-draft", true]]
  );
});

await check("a trigger removed from the draft is still drawn, because it is still listening", () => {
  const map = buildNotebookMap([
    {
      document: doc("a", []),
      deployedDocument: doc("a", [cron("t1", "0 6 * * *")]),
      updatedAt: "2026-11-19T00:00:00.000Z",
      deployed: true,
    },
  ]);
  assert.deepEqual(
    map.triggers.map((trigger) => [trigger.label, trigger.draft]),
    [["0 6 * * *", undefined]]
  );
});

await check("the text an agent reads says which triggers are not active yet", () => {
  const map: NotebookMap = buildNotebookMap([
    {
      document: doc("a", [cron("t1", "0 7 * * *")]),
      deployedDocument: null,
      updatedAt: "2026-11-19T00:00:00.000Z",
      deployed: false,
    },
  ]);
  assert.match(renderNotebookMap(map), /0 7 \* \* \* \(draft/);
});

console.log("\nwhat the endpoint serves");

const PREFIX = "zz-fx15-mp-";
const USER = "zz-fx15-mp-user";

async function cleanup(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE $1", [`${PREFIX}%`]);
  for (const row of rows) await notebooksService.delete(row.id).catch(() => {});
  await pool.query("DELETE FROM users WHERE username = $1", [USER]).catch(() => {});
}

await initDb();
await cleanup();
const OWNER = (await authService.createUser(USER, "zz-fx15-mp-password", "creator")).id;
const token = (await authService.login(USER, "zz-fx15-mp-password")).token;

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

await check("the map's triggers follow a deploy, not a save", async () => {
  const live = { id: `${PREFIX}t-live`, kind: "cron" as const, cron: "0 6 * * *" };
  const id = (
    await notebooksService.save({
      version: "1.0",
      id: "",
      name: `${PREFIX}map`,
      runtime: "node",
      triggers: [live],
      steps: [],
    }, "test", OWNER)
  ).id;
  await notebooksService.deploy(id, "test");
  await notebooksService.save({
    version: "1.0",
    id,
    name: `${PREFIX}map`,
    runtime: "node",
    triggers: [{ ...live, cron: "30 6 * * *" }],
    steps: [],
  }, "test", OWNER);

  const res = await fetch(`${base}/api/notebooks/map`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const map = (await res.json()) as NotebookMap;
  const mine = map.triggers
    .filter((trigger) => trigger.notebookId === id)
    .map((trigger) => [trigger.label, trigger.draft === true]);
  assert.deepEqual(mine.sort(), [
    ["0 6 * * *", false],
    ["30 6 * * *", true],
  ]);
});

await cleanup();
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

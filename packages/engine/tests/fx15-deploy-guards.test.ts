/**
 * FX15 / T-04 — what a deploy refuses.
 *
 * Two refusals, each paired with the case that must still go through: a deployed name
 * another deployed notebook already holds, and a webhook with no secret whose slug is
 * short or odd enough to guess. A refused deploy must leave nothing behind — no version
 * row, no index row — which is checked as hard as the refusal itself.
 *
 * Notebooks it creates are prefixed `zz-fx15-dg-` and removed at the start and the end;
 * so are the secret `ZZ_FX15_DG` and the user `zz-fx15-dg-user`.
 *
 *   pnpm --filter @zaa-tool/engine test fx15-deploy-guards
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import {
  notebooksService,
  DeployRefusedError,
  MIN_OPEN_SLUG_LENGTH,
} from "../src/services/notebooks.service.js";
import { authService } from "../src/services/auth.service.js";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson, NotebookTrigger } from "@zaa-tool/shared";

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

const PREFIX = "zz-fx15-dg-";
const USER = "zz-fx15-dg-user";

async function cleanup(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE $1", [`${PREFIX}%`]);
  for (const row of rows) await notebooksService.delete(row.id).catch(() => {});
  await pool.query("DELETE FROM users WHERE username = $1", [USER]).catch(() => {});
}

await initDb();
await cleanup();
await authService.createUser(USER, "zz-fx15-dg-password", "creator");
const token = (await authService.login(USER, "zz-fx15-dg-password")).token;
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function store(name: string, triggers: NotebookTrigger[] = [], id = ""): Promise<string> {
  const doc: Omit<NotebookJson, "version"> = {
    id,
    name,
    runtime: "node",
    triggers,
    steps: [{ id: `${name}-cell`, kind: "cell", code: "return {};" }],
  };
  return (await notebooksService.save({ version: "1.0", ...doc })).id;
}

async function versionsOf(id: string): Promise<number> {
  const { rows } = await pool.query("SELECT 1 FROM notebook_versions WHERE notebook_id = $1", [id]);
  return rows.length;
}

async function indexRowsOf(id: string): Promise<number> {
  const { rows } = await pool.query("SELECT 1 FROM notebook_triggers WHERE notebook_id = $1", [id]);
  return rows.length;
}

async function deployOverHttp(id: string): Promise<{ status: number; error?: string }> {
  const res = await fetch(`${base}/api/notebooks/${id}/deploy`, { method: "POST", headers: auth });
  const body = (await res.json()) as { error?: string };
  return { status: res.status, error: body.error };
}

const slugOf = (length: number): string => `${PREFIX}`.padEnd(length, "x");

console.log("\na name another deployed notebook holds");

const holderId = await store(`${PREFIX}shared-name`);
await notebooksService.deploy(holderId, "test");

await check("deploying a second notebook under that name is refused, naming the first", async () => {
  const otherId = await store(`${PREFIX}shared-name`);

  await assert.rejects(notebooksService.deploy(otherId, "test"), (err: unknown) => {
    assert.ok(err instanceof DeployRefusedError);
    assert.ok(err.message.includes(holderId), "the message does not name the notebook in the way");
    return true;
  });
  assert.equal(await versionsOf(otherId), 0, "a version was written for a refused deploy");

  const http409 = await deployOverHttp(otherId);
  assert.equal(http409.status, 409);
  assert.ok(http409.error?.includes(holderId), http409.error);
});

await check("drafts may share a name; only deploying is checked", async () => {
  const first = await store(`${PREFIX}draft-twin`);
  const second = await store(`${PREFIX}draft-twin`);
  assert.notEqual(first, second);
});

await check("re-deploying the notebook that holds the name is allowed", async () => {
  await notebooksService.deploy(holderId, "test");
  assert.equal(await versionsOf(holderId), 2);
});

await check("a name is free again once its holder is undeployed", async () => {
  await notebooksService.undeploy(holderId);
  const otherId = await store(`${PREFIX}shared-name`);
  const result = await notebooksService.deploy(otherId, "test");
  assert.ok(result?.versionId);
});

await check("renaming the holder's draft does not free the deployed name", async () => {
  const keeper = await store(`${PREFIX}kept-name`);
  await notebooksService.deploy(keeper, "test");
  await store(`${PREFIX}kept-name-renamed`, [], keeper);

  const claimant = await store(`${PREFIX}kept-name`);
  await assert.rejects(notebooksService.deploy(claimant, "test"), DeployRefusedError);
});

console.log("\na webhook nobody guards");

const hook = (slug: string, extra: Partial<NotebookTrigger> = {}): NotebookTrigger => ({
  id: `${PREFIX}t-${slug.length}-${Math.abs(slug.split("").reduce((a, c) => a + c.charCodeAt(0), 0))}`,
  kind: "webhook",
  slug,
  ...extra,
});

await check("a short slug with no secret is refused, and leaves no version and no index row", async () => {
  const id = await store(`${PREFIX}weak`, [hook(`${PREFIX}short`)]);

  await assert.rejects(notebooksService.deploy(id, "test"), (err: unknown) => {
    assert.ok(err instanceof DeployRefusedError);
    assert.match(err.message, /secretKey/);
    return true;
  });
  assert.equal(await versionsOf(id), 0);
  assert.equal(await indexRowsOf(id), 0);

  const over = await deployOverHttp(id);
  assert.equal(over.status, 409);
  assert.match(over.error ?? "", /secretKey/);
});

await check("the boundary is the declared minimum: one short is refused, exactly it passes", async () => {
  const tooShort = await store(`${PREFIX}edge-short`, [hook(slugOf(MIN_OPEN_SLUG_LENGTH - 1))]);
  await assert.rejects(notebooksService.deploy(tooShort, "test"), DeployRefusedError);

  const longEnough = await store(`${PREFIX}edge-ok`, [hook(slugOf(MIN_OPEN_SLUG_LENGTH))]);
  assert.ok((await notebooksService.deploy(longEnough, "test"))?.versionId);
});

await check("a long slug with characters outside [A-Za-z0-9_-] is refused", async () => {
  for (const bad of ["has space inside-the-slug-xx", "dots.are.not.allowed.here", "slash/in/the/middle-aaaa"]) {
    assert.ok(bad.length >= MIN_OPEN_SLUG_LENGTH, `fixture "${bad}" is too short to test this`);
    const id = await store(`${PREFIX}odd-${bad.length}-${bad.charCodeAt(3)}`, [hook(bad)]);
    await assert.rejects(notebooksService.deploy(id, "test"), DeployRefusedError, bad);
  }
});

await check("a short slug is fine when the webhook has a secret", async () => {
  const id = await store(`${PREFIX}guarded`, [hook("zz-fx15-dg-s", { secretKey: "ZZ_FX15_DG" })]);
  assert.ok((await notebooksService.deploy(id, "test"))?.versionId);
  assert.equal(await indexRowsOf(id), 1);
});

await check("a disabled weak webhook is not listening, so it does not block a deploy", async () => {
  const id = await store(`${PREFIX}disabled`, [hook("zz-fx15-dg-off", { enabled: false })]);
  assert.ok((await notebooksService.deploy(id, "test"))?.versionId);
});

await check("the slug made automatically for a webhook that names none passes", async () => {
  const document = fromMarkdown(
    [
      "---",
      `name: ${PREFIX}auto-slug`,
      "runtime: node",
      "triggers:",
      "  - kind: webhook",
      "---",
      "",
      "```js",
      "return {};",
      "```",
    ].join("\n")
  );
  const { id } = await notebooksService.save(document);
  const slug = document.triggers?.[0]?.slug ?? "";
  assert.ok(slug.length >= MIN_OPEN_SLUG_LENGTH, `automatic slug "${slug}" is too short to be unguessable`);

  assert.ok((await notebooksService.deploy(id, "test"))?.versionId);
  assert.equal(await indexRowsOf(id), 1);
});

await check("the editor's deploy button gets 200 for a deployable notebook", async () => {
  const id = await store(`${PREFIX}http-ok`, [hook(slugOf(MIN_OPEN_SLUG_LENGTH + 5))]);
  const over = await deployOverHttp(id);
  assert.equal(over.status, 200);
});

await cleanup();
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

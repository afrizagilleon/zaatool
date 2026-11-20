/**
 * M16 — a page handed to someone without an account.
 *
 * The token in the URL is the credential, so this file is mostly about what a link
 * *cannot* do: read the notebook, reach an undeployed one, survive revocation, or be
 * turned into a compute farm. Those are the claims worth being sure of, because the
 * whole feature is a door in the authentication wall.
 *
 * Notebooks it creates are prefixed `zz-share-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-share.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookSharesService } from "../src/services/notebook-shares.service.js";
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

await initDb();
const OWNER = (await testOwner("notebookshare")).id;

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const created: string[] = [];

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document }, "test", OWNER);
  if (!created.includes(id)) created.push(id);
  return id;
}

const notebook = (name: string): Omit<NotebookJson, "version"> => ({
  id: "",
  name,
  runtime: "node",
  inputs: [{ name: "n", type: "number", default: 2 }],
  outputs: ["doubled"],
  steps: [
    {
      id: "c1",
      kind: "cell",
      note: "# Doubles a number",
      code: "return { doubled: inputs.n * 2 };",
    },
  ],
});

const open = (token: string, password?: string) =>
  fetch(`${base}/api/shared/${token}`, {
    headers: password ? { "X-Share-Password": password } : {},
  });

console.log("\nwhat a link opens");

const plainId = await store(notebook("zz-share-plain"));
await notebooksService.deploy(plainId, "test");
const plain = await notebookSharesService.create(plainId, "afriza");

await check("the token is returned once, when the link is made", () => {
  assert.ok(plain.token, "no token came back");
  assert.equal(plain.hasPassword, false);
});

await check("the token is not stored where it could be read back", async () => {
  const { rows } = await pool.query("SELECT * FROM notebook_shares WHERE id = $1", [plain.id]);
  const stored = JSON.stringify(rows[0]);
  assert.ok(!stored.includes(plain.token!), "the raw token is in the database");
});

await check("listing links never hands the token back", async () => {
  const listed = await notebookSharesService.listByNotebook(plainId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].token, undefined);
});

await check("opening it describes the page and nothing more", async () => {
  const res = await open(plain.token!);
  assert.equal(res.status, 200);

  const page = await res.json();
  assert.equal(page.name, "zz-share-plain");
  assert.deepEqual(page.outputs, [{ name: "doubled" }]);

  // The notebook itself must never come through this door.
  const body = JSON.stringify(page);
  assert.ok(!body.includes("inputs.n * 2"), "the link leaked the notebook's code");
  assert.ok(!body.includes("steps"), "the link leaked the notebook's structure");
});

await check("running it works, and is recorded against the link", async () => {
  const res = await fetch(`${base}/api/shared/${plain.token}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args: { n: 21 } }),
  });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).runId);

  const [share] = await notebookSharesService.listByNotebook(plainId);
  assert.equal(share.runCount, 1);
  assert.ok(share.lastUsedAt, "the link was used and does not say so");
});

await check("arguments still go through the contract", async () => {
  const res = await fetch(`${base}/api/shared/${plain.token}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args: { n: "not a number" } }),
  });
  assert.equal(res.status, 400);
});

console.log("\nwhat a link cannot do");

await check("an unknown token is a 404, the same as a revoked one", async () => {
  assert.equal((await open("definitely-not-a-token")).status, 404);
});

await check("revoking stops it, and the reason is not distinguishable", async () => {
  const doomed = await notebookSharesService.create(plainId, "afriza");
  assert.equal((await open(doomed.token!)).status, 200);

  await notebookSharesService.revoke(doomed.id, plainId);
  assert.equal((await open(doomed.token!)).status, 404);
  assert.equal((await fetch(`${base}/api/shared/${doomed.token}/run`, { method: "POST" })).status, 404);
});

await check("a link cannot reach a notebook that is out of production", async () => {
  const id = await store(notebook("zz-share-undeployed"));
  await notebooksService.deploy(id, "test");
  const share = await notebookSharesService.create(id, "afriza");
  assert.equal((await open(share.token!)).status, 200);

  await notebooksService.undeploy(id);
  const res = await open(share.token!);
  assert.equal(res.status, 409, "an undeployed page was still served");
  assert.match((await res.json()).error, /production/i);
});

await check("a link runs the deployed version, not the draft", async () => {
  const id = await store(notebook("zz-share-pinned"));
  await notebooksService.deploy(id, "test");
  const share = await notebookSharesService.create(id, "afriza");

  const draft = { ...notebook("zz-share-pinned"), id, name: "renamed in the draft" };
  await notebooksService.save({ version: "1.0", ...draft }, "test", OWNER);

  const page = await (await open(share.token!)).json();
  assert.equal(page.name, "zz-share-pinned", "the link served the draft");
});

console.log("\npasswords");

const lockedId = await store(notebook("zz-share-locked"));
await notebooksService.deploy(lockedId, "test");
const locked = await notebookSharesService.create(lockedId, "afriza", "hunter2");

await check("without the password it says so, and shows nothing", async () => {
  const res = await open(locked.token!);
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.equal(body.needsPassword, true);
  assert.equal(body.name, undefined, "the page leaked past the password");
});

await check("the wrong password is refused", async () => {
  assert.equal((await open(locked.token!, "hunter3")).status, 401);
});

await check("the right password opens it", async () => {
  const res = await open(locked.token!, "hunter2");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, "zz-share-locked");
});

await check("running needs the password too, not just opening", async () => {
  const res = await fetch(`${base}/api/shared/${locked.token}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(res.status, 401, "a locked page could be run without the password");
});

await check("the password is not stored in the clear", async () => {
  const { rows } = await pool.query("SELECT password_hash FROM notebook_shares WHERE id = $1", [
    locked.id,
  ]);
  assert.ok(rows[0].password_hash);
  assert.notEqual(rows[0].password_hash, "hunter2");
});

console.log("\nthe bound");

await check("a link cannot be turned into a compute farm", async () => {
  const id = await store({
    ...notebook("zz-share-busy"),
    steps: [{ id: "c1", kind: "cell", code: "return { doubled: 1 };" }],
  });
  await notebooksService.deploy(id, "test");
  const share = await notebookSharesService.create(id, "afriza");

  let refused = 0;
  for (let attempt = 0; attempt < 34; attempt += 1) {
    const res = await fetch(`${base}/api/shared/${share.token}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: {} }),
    });
    if (res.status === 429) refused += 1;
  }
  assert.ok(refused >= 1, "the link ran 34 times in a row without complaint");
});

console.log("\nbuttons");

await check("a link keeps `rerun` and `link` buttons but never a `run` one", async () => {
  const id = await store({
    ...notebook("zz-share-actions"),
    actions: [
      { label: "Again", do: "rerun" },
      { label: "Email it", do: "run", notebook: "zz-share-secret-target" },
      { label: "Docs", do: "link", url: "https://example.com" },
    ],
  });
  await notebooksService.deploy(id, "test");
  const share = await notebookSharesService.create(id, "afriza");

  const page = await (await open(share.token!)).json();
  assert.deepEqual(
    page.actions.map((action: { do: string }) => action.do),
    ["rerun", "link"],
    "a `run` button survived onto a shared page"
  );
});

await check("and the name of the notebook it would have run never leaves the server", async () => {
  const id = await store({
    ...notebook("zz-share-actions-leak"),
    actions: [{ label: "Email it", do: "run", notebook: "zz-share-secret-target" }],
  });
  await notebooksService.deploy(id, "test");
  const share = await notebookSharesService.create(id, "afriza");

  // The whole response, not just `actions`: filtering in the browser would have left the
  // target's name in the payload, which is a list of what else exists in the workspace.
  const body = await (await open(share.token!)).text();
  assert.ok(
    !body.includes("zz-share-secret-target"),
    "the shared page named a notebook the recipient was not given"
  );
});

for (const id of created) await notebooksService.delete(id).catch(() => {});
await pool.query("DELETE FROM notebook_shares WHERE created_by = 'afriza'").catch(() => {});
await dropOwner("notebookshare");
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

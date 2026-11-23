/**
 * L-01, the last hole: whose secrets a *deployed* version runs with.
 *
 * An invited editor who is a creator can write a cell that prints a secret, deploy it, and
 * then trigger the deployed version. If production used the owner's secrets that would hand
 * the editor the owner's credentials. Production now uses the secrets of whoever deployed
 * that version (`notebook_versions.deployed_by_user_id`).
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/deployer-secrets.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/server/app.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookAccessService } from "../src/services/notebook-access.service.js";
import { secretsService } from "../src/services/secrets.service.js";
import { authService } from "../src/services/auth.service.js";
import { agentTokensService } from "../src/services/agent-tokens.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { notebookExecutionService, secretHolderFor } from "../src/services/notebook-execution.service.js";
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

const OWNER_SECRET = "sk-live-OWNER-SECRET-123";
const EDITOR_SECRET = "editor-key-123456";
const b64 = (s: string): string => Buffer.from(s).toString("base64");
const hex = (s: string): string => Buffer.from(s).toString("hex");
const noOwnerSecret = (text: string, where: string): void => {
  for (const form of [OWNER_SECRET, b64(OWNER_SECRET), hex(OWNER_SECRET)]) {
    assert.ok(!text.includes(form), `${where} carries the owner's secret:\n${text.slice(0, 500)}`);
  }
};

await initDb();
const USERS = ["zz-dep-O", "zz-dep-E", "zz-dep-T"];
const cleanUsers = async (): Promise<void> => {
  for (const u of USERS) await pool.query("DELETE FROM users WHERE username = $1", [u]);
};
await cleanUsers();
const O = await authService.createUser("zz-dep-O", "password-long-ooo1", "creator");
const E = await authService.createUser("zz-dep-E", "password-long-eee1", "creator");
const T = await authService.createUser("zz-dep-T", "password-long-ttt1", "creator");
const tE = (await authService.login("zz-dep-E", "password-long-eee1")).token;
const tO = (await authService.login("zz-dep-O", "password-long-ooo1")).token;

await secretsService.create(O.id, "API_KEY", OWNER_SECRET, true);

// Every event any run publishes, so "nowhere" includes what a socket would have been sent.
const events: unknown[] = [];
const server = http.createServer(createApp((event) => events.push(event)));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const api = (path: string, token: string, init: RequestInit = {}) =>
  fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });

// Warnings go to stderr as JSON lines; keep a copy.
const warnings: string[] = [];
const realWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  warnings.push(String(chunk));
  return (realWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stderr.write;

const created: string[] = [];
/** Saved by the owner, never deployed: the test decides who deploys. */
async function make(doc: Partial<NotebookJson>): Promise<string> {
  const { id } = await notebooksService.save(
    { version: "1.0", id: "", runtime: "node", ...doc } as NotebookJson,
    "test",
    O.id
  );
  created.push(id);
  await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1,$2,'editor')", [id, E.id]);
  return id;
}
const deployAsEditor = async (id: string): Promise<void> => {
  const res = await api(`/api/notebooks/${id}/deploy`, tE, { method: "POST", body: "{}" });
  assert.equal(res.status, 200, await res.clone().text());
};
const deployerOf = async (id: string): Promise<string | null> =>
  (
    await pool.query(
      "SELECT v.deployed_by_user_id AS d FROM notebooks n JOIN notebook_versions v ON v.id = n.deployed_version_id WHERE n.id = $1",
      [id]
    )
  ).rows[0].d;

async function runAs(id: string, options: Parameters<typeof notebookExecutionService.start>[2]) {
  const started = await notebookExecutionService.start(id, (e) => events.push(e), options);
  const result = await started.completed;
  return { result, row: (await notebookRunsService.getById(started.runId))! };
}

// Reports *which* secret it received without relying on printing it; it also prints it, to
// prove that what escapes through logs is only ever redacted.
const TAG_CODE =
  "console.log('key=' + process.env.API_KEY); return { tag: String(process.env.API_KEY ?? 'MISSING').split('-')[0] };";
const HOOK = "zz-dep-hook-abcdefghijklmnopqrstuvwxyz0123";
const appId = await make({
  name: "zz-dep-app",
  secrets: ["API_KEY"],
  outputs: ["tag"],
  inputs: [{ name: "x", type: "string", default: "1" }],
  triggers: [{ id: "t1", kind: "webhook", slug: HOOK } as never],
  steps: [{ id: "c1", kind: "cell", code: TAG_CODE }],
});
const calleeId = await make({
  name: "zz-dep-callee",
  secrets: ["API_KEY"],
  outputs: ["tag"],
  steps: [{ id: "k1", kind: "cell", code: TAG_CODE }],
});
const callerId = await make({
  name: "zz-dep-caller",
  outputs: ["got"],
  inputs: [{ name: "x", type: "string", default: "1" }],
  steps: [{ id: "x1", kind: "cell", code: "const r = await notebooks.run('zz-dep-callee', {}); return { got: r.tag };" }],
});

console.log("\nL-01: a deployed version runs with its deployer's secrets");

await check("the rule", () => {
  assert.deepEqual(secretHolderFor("o", true, "x", "o"), { holder: "o", substituted: false });
  assert.deepEqual(secretHolderFor("o", true, "x", "e"), { holder: "e", substituted: true });
  assert.deepEqual(secretHolderFor("o", true, "x", null), { holder: "o", substituted: false });
  assert.deepEqual(secretHolderFor("o", true, undefined, undefined), { holder: "o", substituted: false });
  assert.deepEqual(secretHolderFor("o", false, "e", "e"), { holder: "e", substituted: true });
});

await check("the owner deploys: production runs with the owner's, as before", async () => {
  await notebooksService.deploy(appId, "zz-dep-O", O.id);
  const { result } = await runAs(appId, { triggerSource: "page", startedBy: E.id });
  assert.deepEqual(result.outputs, { tag: "sk" });
});

await secretsService.create(E.id, "API_KEY", EDITOR_SECRET, true);

await check("the editor deploys a cell that prints the secret: page and webhook runs get the EDITOR's", async () => {
  await deployAsEditor(appId);
  assert.equal(await deployerOf(appId), E.id);
  const page = await runAs(appId, { triggerSource: "page", startedBy: E.id });
  assert.deepEqual(page.result.outputs, { tag: "editor" });
  const hook = await runAs(appId, { triggerSource: "webhook" });
  assert.deepEqual(hook.result.outputs, { tag: "editor" });
  for (const [where, value] of [
    ["page run record", page.row],
    ["page run result", page.result],
    ["webhook run record", hook.row],
    ["webhook run result", hook.result],
  ] as const) noOwnerSecret(JSON.stringify(value), where);
});

await check("an agent calling the app as a tool gets the editor's, and no owner's value in the reply", async () => {
  const token = (await agentTokensService.issue(O.id, "zz-dep-reader", "reader")).token;
  const client = new Client({ name: "zz-dep", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  );
  const name = (await client.listTools()).tools
    .map((t) => t.name)
    .find((n) => n.includes("zz_dep_app") || n.includes("zz-dep-app"));
  assert.ok(name, "the app is not offered as a tool");
  const reply = (await client.callTool({ name: name!, arguments: {} })) as { content: { text: string }[] };
  const text = reply.content[0].text;
  assert.ok(text.includes("editor"), text);
  noOwnerSecret(text, "the tool reply");
  await client.close();
});

await check("the deploy state tells the owner whose secrets production uses", async () => {
  const state = (await (await api(`/api/notebooks/${appId}/deploy`, tO)).json()) as {
    deployedBy: string;
    productionSecretsFrom: string | null;
  };
  assert.equal(state.productionSecretsFrom, "zz-dep-E");
  assert.equal(state.deployedBy, "zz-dep-E");
});

await check("nothing published so far has carried the owner's secret", () => {
  noOwnerSecret(JSON.stringify(events), "published events");
});

await check("a deployer who lacks the secret leaves it missing, and the log says so", async () => {
  await pool.query("DELETE FROM secrets WHERE owner_id = $1 AND key = 'API_KEY'", [E.id]);
  const { result, row } = await runAs(appId, { triggerSource: "webhook" });
  assert.deepEqual(result.outputs, { tag: "MISSING" });
  const notes = (row.cell_results.c1?.logs ?? []).filter((l) => l.msg.includes("deployer's"));
  assert.equal(notes.length, 1, JSON.stringify(row.cell_results.c1?.logs));
  assert.ok(notes[0].msg.includes('"API_KEY"'));
  noOwnerSecret(JSON.stringify(row), "the run record");
  await secretsService.create(E.id, "API_KEY", EDITOR_SECRET, true);
});

await check("the owner redeploys: the owner's secrets again", async () => {
  await notebooksService.deploy(appId, "zz-dep-O", O.id);
  assert.equal(await deployerOf(appId), O.id);
  const { result } = await runAs(appId, { triggerSource: "webhook" });
  assert.deepEqual(result.outputs, { tag: "sk" });
});

await check("a callee deployed by an editor uses that editor's secrets, even under the owner's caller", async () => {
  await notebooksService.deploy(callerId, "zz-dep-O", O.id);
  await deployAsEditor(calleeId);
  const { result, row } = await runAs(callerId, { triggerSource: "page", startedBy: O.id });
  assert.deepEqual(result.outputs, { got: "editor" });
  noOwnerSecret(JSON.stringify(row), "the caller's run record");
  noOwnerSecret(JSON.stringify(events), "published events");
  // And when the owner deploys the callee, the owner's again.
  await notebooksService.deploy(calleeId, "zz-dep-O", O.id);
  assert.deepEqual((await runAs(callerId, { triggerSource: "page", startedBy: O.id })).result.outputs, { got: "sk" });
});

await check("a legacy version with no deploying account runs as the owner, with one warning per version", async () => {
  await deployAsEditor(appId);
  await pool.query(
    "UPDATE notebook_versions SET deployed_by_user_id = NULL WHERE id = (SELECT deployed_version_id FROM notebooks WHERE id = $1)",
    [appId]
  );
  const before = warnings.length;
  const first = await runAs(appId, { triggerSource: "webhook" });
  assert.deepEqual(first.result.outputs, { tag: "sk" });
  await runAs(appId, { triggerSource: "webhook" });
  const unknown = warnings.slice(before).filter((w) => w.includes("secrets.deployer_unknown"));
  assert.equal(unknown.length, 1, unknown.join());
});

await check("transferring the notebook keeps the deployer: production does not switch to the new owner's secrets", async () => {
  await deployAsEditor(appId);
  assert.equal(await deployerOf(appId), E.id);
  await secretsService.create(T.id, "API_KEY", "third-party-key-999", true);
  const moved = await notebookAccessService.transferOwner("zz-dep-T", { username: "zz-dep-O", notebookId: appId });
  assert.deepEqual(moved.notebooks, [appId]);
  assert.equal(await deployerOf(appId), E.id);
  const { result, row } = await runAs(appId, { triggerSource: "webhook" });
  assert.deepEqual(result.outputs, { tag: "editor" });
  noOwnerSecret(JSON.stringify(row), "the run record after the transfer");
});

for (const id of created) await notebooksService.delete(id).catch(() => {});
await pool.query("DELETE FROM secrets WHERE owner_id IN ($1,$2,$3)", [O.id, E.id, T.id]);
await pool.query("DELETE FROM agent_tokens WHERE label LIKE 'zz-dep-%'");
await cleanUsers();
server.close();
await pool.end();
process.stderr.write = realWrite;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

/**
 * C-07 — saving a notebook cannot silently overwrite somebody else's save.
 *
 * Every copy of a notebook that is handed out carries the revision it was read at, and a
 * save that names one is refused if the notebook has moved on. The three writers are
 * covered: the service, the editor's REST door, and the MCP tools (which use the revision
 * they read, so an edit made while they were working is refused rather than lost).
 *
 * A save over a notebook that exists must name the revision it read: without one it is
 * refused (428 `revision_required`), because a blind overwrite is how an edit gets lost. A
 * server-side write that really is blind says so with `expectedRevision: "any"`.
 *
 * Everything it makes is prefixed `zz-w2rev-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test w2-save-revision
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerNotebookTools } from "../src/mcp/notebook-tools.js";
import { createApp } from "../src/server/app.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebooksService, NotebookConflictError, NotebookRevisionRequiredError } from "../src/services/notebooks.service.js";
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
const owner = await testOwner("w2rev");

async function clean(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-w2rev-%'");
  for (const row of rows) await notebooksService.delete(row.id).catch(() => undefined);
}
await clean();

const twoCells = (name: string): NotebookJson => ({
  version: "1.0",
  id: "",
  name,
  runtime: "node",
  steps: [
    { id: "c1", kind: "cell", code: "return { one: 1 };" },
    { id: "c2", kind: "cell", code: "return { two: 2 };" },
  ],
});

const withCode = (document: NotebookJson, cell: string, code: string): NotebookJson => ({
  ...document,
  steps: document.steps.map((step) => (step.id === cell && step.kind === "cell" ? { ...step, code } : step)),
});

const stored = async (id: string): Promise<NotebookJson> =>
  notebooksService.parseDocument((await notebooksService.getById(id))!);
const codeOf = (document: NotebookJson, cell: string): string | undefined => {
  const step = document.steps.find((candidate) => candidate.id === cell);
  return step && step.kind === "cell" ? step.code : undefined;
};

console.log("\nthe service");

await check("a save from the current revision goes through and moves the revision on", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-service"), "test", owner.id);
  assert.equal(first.revision, 1);
  const second = await notebooksService.save(
    { ...twoCells("zz-w2rev-service"), id: first.id },
    "test",
    owner.id,
    { expectedRevision: first.revision }
  );
  assert.equal(second.revision, 2);
});

await check("a save from an older revision is refused and changes nothing", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-stale"), "test", owner.id);
  const base = await stored(first.id);
  await notebooksService.save(withCode({ ...base, id: first.id }, "c1", "return 'theirs';"), "editor", owner.id, {
    expectedRevision: first.revision,
  });

  await assert.rejects(
    notebooksService.save(withCode({ ...base, id: first.id }, "c2", "return 'mine';"), "agent", owner.id, {
      expectedRevision: first.revision,
    }),
    (err: unknown) => err instanceof NotebookConflictError && err.currentRevision === 2
  );
  const after = await stored(first.id);
  assert.equal(codeOf(after, "c1"), "return 'theirs';");
  assert.equal(codeOf(after, "c2"), "return { two: 2 };", "the refused save wrote something");
});

await check("two saves made from the same revision at once: one wins, one is refused", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-race"), "test", owner.id);
  const base = { ...(await stored(first.id)), id: first.id };
  const results = await Promise.allSettled([
    notebooksService.save(withCode(base, "c1", "return 'editor';"), "editor", owner.id, { expectedRevision: 1 }),
    notebooksService.save(withCode(base, "c2", "return 'agent';"), "agent", owner.id, { expectedRevision: 1 }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(refused.reason instanceof NotebookConflictError, String(refused.reason));
  assert.equal((await notebooksService.getById(first.id))!.revision, 2);
});

await check("a save that names no revision is refused when the notebook exists, and changes nothing", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-legacy"), "test", owner.id);
  const base = { ...(await stored(first.id)), id: first.id };
  await notebooksService.save(withCode(base, "c1", "return 'new';"), "editor", owner.id, { expectedRevision: 1 });
  await assert.rejects(
    notebooksService.save(withCode(base, "c2", "return 'old client';"), "old", owner.id),
    (err: unknown) => err instanceof NotebookRevisionRequiredError && err.currentRevision === 2
  );
  const row = (await notebooksService.getById(first.id))!;
  assert.equal(row.revision, 2, "a refused save still bumped the revision");
  assert.equal(codeOf(await stored(first.id), "c1"), "return 'new';", "the blind save replaced the newer copy");
});

await check("creating a notebook needs no revision", async () => {
  const made = await notebooksService.save(twoCells("zz-w2rev-new"), "test", owner.id);
  assert.equal(made.revision, 1);
});

await check('"any" is the explicit way to write without having read', async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-any"), "test", owner.id);
  const base = { ...(await stored(first.id)), id: first.id };
  const forced = await notebooksService.save(withCode(base, "c1", "return 'forced';"), "cli", owner.id, { expectedRevision: "any" });
  assert.equal(forced.revision, 2);
});

console.log("\nthe editor's door");

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const headers = {
  "Content-Type": "application/json",
  "X-Zaatool-Request": "1",
  Authorization: `Bearer ${owner.token}`,
};

await check("a notebook is handed out with its revision, which is never stored in the document", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-http"), "test", owner.id);
  const got = (await (await fetch(`${base}/api/notebooks/${first.id}`, { headers })).json()) as NotebookJson;
  assert.equal(got.revision, 1);

  const saved = await fetch(`${base}/api/notebooks`, { method: "POST", headers, body: JSON.stringify(got) });
  assert.equal(saved.status, 200);
  assert.equal(((await saved.json()) as { revision: number }).revision, 2);
  assert.equal("revision" in (await stored(first.id)), false, "the revision was written into the document");
});

await check("a stale save is a 409 that says so, and the editor can tell it from a failure", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-409"), "test", owner.id);
  const mine = (await (await fetch(`${base}/api/notebooks/${first.id}`, { headers })).json()) as NotebookJson;
  // Somebody else saves in between, which is the point of the case.
  await notebooksService.save({ ...(await stored(first.id)), id: first.id }, "agent", owner.id, { expectedRevision: 1 });

  const refused = await fetch(`${base}/api/notebooks`, { method: "POST", headers, body: JSON.stringify(withCode(mine, "c1", "return 'mine';")) });
  assert.equal(refused.status, 409);
  const body = (await refused.json()) as { code: string; currentRevision: number; error: string };
  assert.equal(body.code, "conflict");
  assert.equal(body.currentRevision, 2);
  assert.match(body.error, /changed by someone else/);
  assert.notEqual(codeOf(await stored(first.id), "c1"), "return 'mine';");
});

await check("a client that sends no revision for an existing notebook gets 428 revision_required", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-http-old"), "test", owner.id);
  const { revision: _dropped, ...legacy } = (await (await fetch(`${base}/api/notebooks/${first.id}`, { headers })).json()) as NotebookJson;
  const res = await fetch(`${base}/api/notebooks`, { method: "POST", headers, body: JSON.stringify(withCode(legacy as NotebookJson, "c1", "return 'blind';")) });
  assert.equal(res.status, 428);
  const body = (await res.json()) as { code: string; error: string };
  assert.equal(body.code, "revision_required");
  assert.match(body.error, /revision/);
  assert.notEqual(codeOf(await stored(first.id), "c1"), "return 'blind';");
});

await check("creating a notebook over the REST door needs no revision", async () => {
  const res = await fetch(`${base}/api/notebooks`, { method: "POST", headers, body: JSON.stringify(twoCells("zz-w2rev-http-new")) });
  assert.equal(res.status, 200);
});

await check("the text endpoint refuses a blind overwrite too, but an import as new is exempt", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-text"), "test", owner.id);
  const text = await (await fetch(`${base}/api/notebooks/${first.id}/text`, { headers })).text();
  const blind = await fetch(`${base}/api/notebooks/text`, { method: "POST", headers, body: JSON.stringify({ text }) });
  assert.equal(blind.status, 428);
  assert.equal(((await blind.json()) as { code: string }).code, "revision_required");
  const named = await fetch(`${base}/api/notebooks/text`, { method: "POST", headers, body: JSON.stringify({ text, revision: 1 }) });
  assert.equal(named.status, 200);
  const asNew = await fetch(`${base}/api/notebooks/text`, { method: "POST", headers, body: JSON.stringify({ text: text.replace("name: zz-w2rev-text", "name: zz-w2rev-text-imported"), asNew: true }) });
  assert.equal(asNew.status, 200);
});

console.log("\nthe MCP tools");

const mcp = new McpServer({ name: "zaatool", version: "1.0.0" });
registerNotebookTools(mcp, { publishRunEvent: () => {}, writer: "test-agent", userId: owner.id }, "author");
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await mcp.connect(serverTransport);
const agent = new Client({ name: "test-agent", version: "1.0.0" });
await agent.connect(clientTransport);

interface ToolReply {
  content: { type: string; text: string }[];
  isError?: boolean;
}
const call = async (name: string, args: Record<string, unknown>): Promise<ToolReply> =>
  (await agent.callTool({ name, arguments: args })) as unknown as ToolReply;

await check("an edit made between the tool's read and its write is refused, not overwritten", async () => {
  const first = await notebooksService.save(twoCells("zz-w2rev-tool"), "test", owner.id);

  // Held between reading and writing, so that both tools have read before either has written:
  // the interleaving the bug needs, made certain rather than left to timing.
  const realSave = notebooksService.save.bind(notebooksService);
  notebooksService.save = async (...args: Parameters<typeof realSave>) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return realSave(...args);
  };
  let replies: ToolReply[];
  try {
    replies = await Promise.all([
      call("notebook_edit_cell", { notebook: first.id, action: "replace", cell: "c1", code: "return { one: 'a' };" }),
      call("notebook_edit_cell", { notebook: first.id, action: "replace", cell: "c2", code: "return { two: 'b' };" }),
    ]);
  } finally {
    notebooksService.save = realSave;
  }

  const failures = replies.filter((reply) => reply.isError);
  assert.equal(failures.length, 1, JSON.stringify(replies));
  assert.match(failures[0].content[0].text, /changed by someone else/);
  assert.match(failures[0].content[0].text, /notebook_read/, "the agent is not told what to do next");
  const final = await stored(first.id);
  const winners = [codeOf(final, "c1") !== "return { one: 1 };", codeOf(final, "c2") !== "return { two: 2 };"];
  assert.equal(winners.filter(Boolean).length, 1, "both edits landed, or neither did");
});

await agent.close();
server.close();
await clean();
await dropOwner("w2rev");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

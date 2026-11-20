/**
 * M6 — the agent's door, driven as an agent drives it.
 *
 * A real MCP client is connected to the real server over an in-memory transport, so
 * tool schemas, argument validation and every handler are exercised through the
 * protocol rather than called directly. Underneath, the real services and the real
 * database: a notebook written here is a notebook you can open in the editor.
 *
 * Notebooks it creates are prefixed `zz-mcp-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/mcp-integration.test.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerNotebookTools } from "../src/mcp/notebook-tools.js";
import { registerConventions } from "../src/mcp/conventions.js";
import { agentTokensService, type AgentScope } from "../src/services/agent-tokens.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
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
const OWNER = (await testOwner("mcpintegration")).id;

/** A client wired to a server with the given scope, exactly as the route builds it. */
async function connect(scope: AgentScope): Promise<Client> {
  const server = new McpServer({ name: "zaatool", version: "1.0.0" });
  registerNotebookTools(server, { publishRunEvent: () => {}, writer: "test-agent", userId: OWNER }, scope);
  registerConventions(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

const author = await connect("author");
const reader = await connect("reader");

interface ToolReply {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<ToolReply> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolReply;
}

const textOf = (result: ToolReply): string =>
  result.content.map((part) => part.text ?? "").join("\n");

const jsonOf = (result: ToolReply): Record<string, unknown> => JSON.parse(textOf(result));

const created: string[] = [];

async function write(text: string, extra: Record<string, unknown> = {}): Promise<ToolReply> {
  const result = await call(author, "notebook_write", { text, ...extra });
  const id = /`([0-9a-f-]{36})`/.exec(textOf(result))?.[1];
  if (id && !created.includes(id)) created.push(id);
  return result;
}

// ── what each scope may reach ─────────────────────────────────────────────────

console.log("\nscopes");

await check("an author sees the writing tools", async () => {
  const names = (await author.listTools()).tools.map((tool) => tool.name);
  for (const expected of [
    "notebook_list",
    "notebook_read",
    "notebook_write",
    "notebook_delete",
    "notebook_run",
    "notebook_run_cell",
    "run_list",
    "run_inspect",
    "secret_list_names",
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
});

await check("a reader is not offered a way to write or delete", async () => {
  const names = (await reader.listTools()).tools.map((tool) => tool.name);
  assert.ok(!names.includes("notebook_write"), "reader was offered notebook_write");
  assert.ok(!names.includes("notebook_delete"), "reader was offered notebook_delete");
  assert.ok(names.includes("notebook_read"), "reader cannot read");
  assert.ok(names.includes("notebook_run"), "reader cannot run");
});

await check("no tool anywhere hands back a secret's value", async () => {
  const names = (await author.listTools()).tools.map((tool) => tool.name);
  assert.ok(
    !names.some((name) => /secret/.test(name) && !/list_names/.test(name)),
    `unexpected secret tool: ${names.filter((n) => /secret/.test(n)).join(", ")}`
  );
});

// ── writing, the way an agent writes ──────────────────────────────────────────

console.log("\nwriting");

await check("prose and one code block is enough to create a notebook", async () => {
  const result = await write(
    ["---", "name: zz-mcp-hello", "runtime: node", "---", "", "Say hello.", "", "```js", "return { greeting: 'hi' };", "```"].join("\n")
  );

  const text = textOf(result);
  assert.ok(!result.isError, text);
  assert.match(text, /Created \*\*zz-mcp-hello\*\*/);
  assert.match(text, /Compiles\. 1 runnable cell/);
});

await check("reading it back gives text that can be written back unchanged", async () => {
  const first = textOf(await call(author, "notebook_read", { notebook: "zz-mcp-hello" }));
  await write(first);
  const second = textOf(await call(author, "notebook_read", { notebook: "zz-mcp-hello" }));
  assert.equal(second, first);
});

await check("a second write updates rather than duplicating", async () => {
  const before = (await notebooksService.getSummary()).filter((n) => n.name === "zz-mcp-hello");
  assert.equal(before.length, 1, "expected exactly one zz-mcp-hello");
});

await check("bad markdown is refused with the specific reason", async () => {
  const result = await call(author, "notebook_write", { text: "no front matter here" });
  assert.ok(result.isError, "expected a refusal");
  assert.match(textOf(result), /front matter/);
});

await check("a notebook that does not compile is still saved, and says so", async () => {
  const result = await write(
    ["---", "name: zz-mcp-broken", "inputs:", "  - { name: a, type: string }", "  - { name: a, type: number }", "---", "", "```js", "return {};", "```"].join("\n")
  );
  const text = textOf(result);
  assert.match(text, /does not compile yet/);
  assert.ok(await notebooksService.findByIdOrName("zz-mcp-broken"), "it was not saved");
});

await check("a reader cannot call the write tool even knowing its name", async () => {
  const result = await call(reader, "notebook_write", { text: "---\nname: zz-mcp-nope\n---\n" });
  assert.ok(result.isError, "a reader managed to write");
});

await check("a reader is offered none of the four editing tools, an author all of them", async () => {
  const editing = ["notebook_write", "notebook_delete", "notebook_edit_cell", "notebook_edit_setup"];
  const readerNames = (await reader.listTools()).tools.map((tool) => tool.name);
  const authorNames = (await author.listTools()).tools.map((tool) => tool.name);
  for (const name of editing) {
    assert.ok(!readerNames.includes(name), `reader was offered ${name}`);
    assert.ok(authorNames.includes(name), `author is missing ${name}`);
  }
});

await check("a reader cannot edit a cell or the setup, and the stored notebook is untouched", async () => {
  const made = await write(
    ["---", "name: zz-f1-reader-edit", "runtime: node", "---", "", "Original.", "", "```js", "return { ok: 1 };", "```"].join("\n")
  );
  assert.ok(!made.isError, textOf(made));

  const stored = async (): Promise<string> => {
    const record = await notebooksService.findByIdOrName("zz-f1-reader-edit");
    assert.ok(record && record !== "ambiguous", "fixture notebook missing");
    return JSON.stringify({ document: notebooksService.parseDocument(record), updated_at: record.updated_at });
  };
  const before = await stored();

  const cell = await call(reader, "notebook_edit_cell", {
    notebook: "zz-f1-reader-edit",
    action: "replace",
    cell: "1",
    code: "return { pwned: true };",
  });
  assert.ok(cell.isError, "a reader edited a cell");

  const setup = await call(reader, "notebook_edit_setup", {
    notebook: "zz-f1-reader-edit",
    key: "name",
    value: JSON.stringify("zz-f1-renamed"),
  });
  assert.ok(setup.isError, "a reader edited the setup");

  assert.equal(await stored(), before, "the stored notebook changed");
});

// ── the loop the whole thing exists for ───────────────────────────────────────

console.log("\nrunning");

await check("running one cell returns what it actually produced", async () => {
  await write(
    [
      "---",
      "name: zz-mcp-steps",
      "runtime: node",
      "outputs: [doubled]",
      "---",
      "",
      "<!-- zaa:cell id=zz-a -->",
      "<!-- zaa:code -->",
      "```js",
      "return { seed: 21 };",
      "```",
      "",
      "<!-- zaa:cell id=zz-b -->",
      "<!-- zaa:code -->",
      "```js",
      "if (inputs.seed === undefined) throw new Error('seed is not in scope');",
      "return { doubled: inputs.seed * 2 };",
      "```",
    ].join("\n")
  );

  const result = jsonOf(await call(author, "notebook_run_cell", { notebook: "zz-mcp-steps", cell: "zz-a" }));
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.deepEqual((result.cells as Record<string, { output: unknown }>)["zz-a"].output, { seed: 21 });
});

await check("a cell can be named by its position, because that is how it reads", async () => {
  const result = jsonOf(await call(author, "notebook_run_cell", { notebook: "zz-mcp-steps", cell: "1" }));
  assert.deepEqual((result.cells as Record<string, { output: unknown }>)["zz-a"].output, { seed: 21 });
});

await check("a single cell starts empty, and `input` stands in for earlier cells", async () => {
  const alone = jsonOf(await call(author, "notebook_run_cell", { notebook: "zz-mcp-steps", cell: "2" }));
  assert.equal(alone.status, "failed", "cell 2 should not see `seed` on its own");

  const seeded = jsonOf(
    await call(author, "notebook_run_cell", {
      notebook: "zz-mcp-steps",
      cell: "2",
      input: { seed: 5 },
    })
  );
  assert.equal(seeded.status, "success", JSON.stringify(seeded));
  assert.deepEqual((seeded.cells as Record<string, { output: unknown }>)["zz-b"].output, { doubled: 10 });
});

await check("a nonexistent cell is refused, and the reply lists the real ones", async () => {
  const result = await call(author, "notebook_run_cell", { notebook: "zz-mcp-steps", cell: "nope" });
  assert.ok(result.isError, "expected a refusal");
  assert.match(textOf(result), /1=zz-a/);
});

await check("running the whole notebook returns its declared outputs", async () => {
  const result = jsonOf(await call(author, "notebook_run", { notebook: "zz-mcp-steps" }));
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.deepEqual(result.outputs, { doubled: 42 });
});

await check("an undeclared name does not leak to the caller", async () => {
  const result = jsonOf(await call(author, "notebook_run", { notebook: "zz-mcp-steps" }));
  assert.deepEqual(Object.keys(result.outputs as object), ["doubled"]);
});

await check("a failing cell comes back as an error the agent can read", async () => {
  await write(
    ["---", "name: zz-mcp-fails", "runtime: node", "---", "", "```js", "throw new Error('kaboom');", "```"].join("\n")
  );

  const result = jsonOf(await call(author, "notebook_run", { notebook: "zz-mcp-fails" }));
  assert.equal(result.status, "failed");
  assert.match(JSON.stringify(result), /kaboom/);
});

await check("a missing required argument is refused before the notebook starts", async () => {
  await write(
    [
      "---",
      "name: zz-mcp-contract",
      "runtime: node",
      "inputs:",
      "  - { name: n, type: number, required: true }",
      "outputs: [twice]",
      "---",
      "",
      "```js",
      "return { twice: inputs.n * 2 };",
      "```",
    ].join("\n")
  );

  const refused = await call(author, "notebook_run", { notebook: "zz-mcp-contract" });
  assert.ok(refused.isError, "expected a refusal");
  assert.match(textOf(refused), /"n" is required/);

  const ok = jsonOf(await call(author, "notebook_run", { notebook: "zz-mcp-contract", args: { n: "21" } }));
  assert.deepEqual(ok.outputs, { twice: 42 }, "a numeric string should coerce");
});

await check("a python notebook runs through the same door", async () => {
  await write(
    ["---", "name: zz-mcp-python", "runtime: python", "outputs: [total]", "---", "", "```python", "print('working')", "return {'total': 7}", "```"].join("\n")
  );

  const result = jsonOf(await call(author, "notebook_run", { notebook: "zz-mcp-python" }));
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.deepEqual(result.outputs, { total: 7 });
});

// ── the record left behind ────────────────────────────────────────────────────

console.log("\nhistory");

await check("the run is readable the instant the tool answers", async () => {
  const run = jsonOf(await call(author, "notebook_run", { notebook: "zz-mcp-steps" }));
  const inspected = jsonOf(await call(author, "run_inspect", { run: String(run.runId) }));
  assert.equal(inspected.id, run.runId);
  assert.deepEqual(Object.keys(inspected.cell_results as object).sort(), ["zz-a", "zz-b"]);
});

await check("a past run keeps the code that produced it", async () => {
  const inspected = jsonOf(await call(author, "run_inspect", { run: "zz-mcp-fails" }));
  const cells = Object.values(inspected.cell_results as Record<string, { source?: string; error?: string }>);
  assert.ok(cells.some((cell) => cell.source?.includes("kaboom")), "no recorded source");
  assert.ok(cells.some((cell) => cell.error), "no recorded error");
});

await check("run_list shows the runs newest first", async () => {
  const runs = JSON.parse(textOf(await call(author, "run_list", { notebook: "zz-mcp-steps" }))) as {
    started_at: string;
  }[];
  assert.ok(runs.length >= 2, "expected several runs");
  assert.ok(
    new Date(runs[0].started_at) >= new Date(runs[1].started_at),
    "runs are not newest first"
  );
});

await check("listing shows contracts and triggers so an agent can reuse instead of rewrite", async () => {
  const listed = textOf(await call(author, "notebook_list"));
  assert.match(listed, /zz-mcp-contract/);
  assert.match(listed, /\(n: number!\) → \{twice\}/);
});

// ── secrets and deletion ──────────────────────────────────────────────────────

console.log("\nguard rails");

await check("secret_list_names returns names and no values", async () => {
  await pool.query(
    `INSERT INTO secrets (id, key, value, is_secret, owner_id) VALUES ($1, $2, $3, TRUE, $4)
     ON CONFLICT (owner_id, key) DO NOTHING`,
    ["zz-mcp-secret-id", "ZZ_MCP_SECRET", "super-secret-value", OWNER]
  );

  const listed = textOf(await call(author, "secret_list_names"));
  assert.match(listed, /ZZ_MCP_SECRET/);
  assert.ok(!listed.includes("super-secret-value"), "a secret value was disclosed");

  await pool.query("DELETE FROM secrets WHERE key = $1", ["ZZ_MCP_SECRET"]);
});

await check("deleting refuses unless the name is typed again", async () => {
  const refused = await call(author, "notebook_delete", {
    notebook: "zz-mcp-fails",
    confirmName: "something else",
  });
  assert.ok(refused.isError, "expected a refusal");
  assert.ok(await notebooksService.findByIdOrName("zz-mcp-fails"), "it was deleted anyway");

  const done = await call(author, "notebook_delete", {
    notebook: "zz-mcp-fails",
    confirmName: "zz-mcp-fails",
  });
  assert.ok(!done.isError, textOf(done));
  assert.equal(await notebooksService.findByIdOrName("zz-mcp-fails"), null);
});

// ── asking before it reaches the world ────────────────────────────────────────

console.log("\napproval");

/** A client that can be asked, answering every elicitation the same way. */
async function connectAnswering(answer: boolean | "decline" | "accept-only"): Promise<Client> {
  const server = new McpServer({ name: "zaatool", version: "1.0.0" });
  registerNotebookTools(server, { publishRunEvent: () => {}, writer: "test-agent", userId: OWNER }, "author");

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client(
    { name: "test-agent-with-buttons", version: "1.0.0" },
    { capabilities: { elicitation: {} } }
  );
  client.setRequestHandler(ElicitRequestSchema, async () => {
    if (answer === "decline") return { action: "decline" as const };
    // How Hermes answers: an elicitation is a pair of buttons, so tapping Approve sends
    // `accept` and nothing else. The schema must not demand a field it will never send.
    if (answer === "accept-only") return { action: "accept" as const };
    return { action: "accept" as const, content: { approve: answer } };
  });

  await client.connect(clientTransport);
  return client;
}

const withCron = (name: string) =>
  [
    "---",
    `name: ${name}`,
    "runtime: node",
    "triggers:",
    '  - { kind: cron, cron: "0 9 * * *" }',
    "---",
    "",
    "```js",
    "return { ok: 1 };",
    "```",
  ].join("\n");

await check("adding a trigger no longer needs approval, because it is not live", async () => {
  const result = await write(withCron("zz-mcp-cron"));
  assert.ok(!result.isError, textOf(result));
  assert.match(textOf(result), /Not deployed/);
});

await check("saving without touching triggers needs no approval", async () => {
  const plain = await write(
    ["---", "name: zz-mcp-plain", "runtime: node", "---", "", "```js", "return { ok: 1 };", "```"].join("\n")
  );
  assert.ok(!plain.isError, textOf(plain));
});

await check("a client that answers accept with no form is approving", async () => {
  await write(
    ["---", "name: zz-mcp-buttons", "runtime: node", "---", "", "```js", "return {};", "```"].join("\n")
  );

  const buttons = await connectAnswering("accept-only");
  const result = await call(buttons, "notebook_delete", { notebook: "zz-mcp-buttons" });

  assert.ok(!result.isError, textOf(result));
  assert.equal(await notebooksService.findByIdOrName("zz-mcp-buttons"), null);
  await buttons.close();
});

await check("an unticked checkbox inside an accepted form is still a no", async () => {
  await write(
    ["---", "name: zz-mcp-unticked", "runtime: node", "---", "", "```js", "return {};", "```"].join("\n")
  );

  const unticked = await connectAnswering(false);
  const result = await call(unticked, "notebook_delete", { notebook: "zz-mcp-unticked" });

  assert.ok(result.isError, "an unticked approval deleted the notebook");
  assert.ok(await notebooksService.findByIdOrName("zz-mcp-unticked"), "it was deleted anyway");
  await unticked.close();
});

await check("deleting asks too, and a decline leaves the notebook alone", async () => {
  const declining = await connectAnswering("decline");
  const result = await call(declining, "notebook_delete", { notebook: "zz-mcp-cron" });

  assert.ok(result.isError, "it was deleted after a decline");
  assert.ok(await notebooksService.findByIdOrName("zz-mcp-cron"), "the notebook is gone");
  await declining.close();
});

// ── house rules ───────────────────────────────────────────────────────────────

console.log("\nconventions");

await check("the house rules are offered as a resource, and a reader gets them too", async () => {
  for (const client of [author, reader]) {
    const uris = (await client.listResources()).resources.map((resource) => resource.uri);
    assert.ok(uris.includes("zaa://conventions"), `missing conventions: ${uris.join(", ")}`);
  }
});

await check("reading them returns the skills stored in the workspace", async () => {
  await pool.query(
    `INSERT INTO skills (id, name, description, content) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    ["zz-mcp-skill", "zz-mcp-rule", "how we name things", "Prefer verbs. Never inline a secret."]
  );

  const read = await author.readResource({ uri: "zaa://conventions" });
  const first = read.contents[0] as { text?: string } | undefined;
  const text = String(first?.text ?? "");
  assert.match(text, /zz-mcp-rule/);
  assert.match(text, /Never inline a secret/);

  await pool.query("DELETE FROM skills WHERE id = $1", ["zz-mcp-skill"]);
});

// ── tokens ────────────────────────────────────────────────────────────────────

console.log("\ntokens");

await check("a token verifies once, and never again after it is revoked", async () => {
  const { token, record } = await agentTokensService.issue(OWNER, "zz-mcp-test", "reader");

  const verified = await agentTokensService.verify(token);
  assert.equal(verified?.id, record.id);
  assert.equal(verified?.scope, "reader");

  await agentTokensService.revoke(record.id);
  assert.equal(await agentTokensService.verify(token), null);
});

await check("the token itself is never stored", async () => {
  const { token, record } = await agentTokensService.issue(OWNER, "zz-mcp-test-2", "author");
  const { rows } = await pool.query("SELECT token_hash FROM agent_tokens WHERE id = $1", [record.id]);
  assert.notEqual(rows[0].token_hash, token, "the raw token is in the database");
  assert.equal(rows[0].token_hash.length, 64, "expected a sha256 hash");
  await agentTokensService.revoke(record.id);
});

await check("nonsense is not a token", async () => {
  assert.equal(await agentTokensService.verify("not-a-token"), null);
  assert.equal(await agentTokensService.verify(""), null);
});

// ── cleanup ───────────────────────────────────────────────────────────────────

for (const id of created) {
  await notebooksService.delete(id).catch(() => {});
}
await pool.query("DELETE FROM agent_tokens WHERE label LIKE 'zz-mcp-%'");
await author.close();
await reader.close();
await dropOwner("mcpintegration");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

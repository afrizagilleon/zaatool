/**
 * M9 — a deployed notebook is a tool.
 *
 * An agent writes a notebook, you deploy it, and the agent has a new permanent
 * capability. What matters is that it is *your* capability: only deployed versions are
 * offered, so a draft cannot become one by accident, and the tool runs the deployed
 * document even while the draft has moved on.
 *
 * Notebooks it creates are prefixed `zz-cat-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-catalog.test.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerDeployedNotebooks, toolNameFor } from "../src/mcp/notebook-catalog.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
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
const OWNER = (await testOwner("notebookcatalog")).id;

const created: string[] = [];

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document }, "test", OWNER);
  if (!created.includes(id)) created.push(id);
  return id;
}

/** A client seeing the catalogue exactly as an agent would. */
async function connect(): Promise<Client> {
  const server = new McpServer({ name: "zaatool", version: "1.0.0" });
  await registerDeployedNotebooks(server, { publishRunEvent: () => {}, userId: OWNER });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

const opened: Client[] = [];
async function tools(): Promise<{ name: string; description?: string }[]> {
  const client = await connect();
  opened.push(client);
  return (await client.listTools()).tools;
}

interface ToolReply {
  content: { type: string; text: string }[];
  isError?: boolean;
}

const adder = (name: string, marker: string): Omit<NotebookJson, "version"> => ({
  id: "",
  name,
  runtime: "node",
  inputs: [
    { name: "a", type: "number", required: true },
    { name: "b", type: "number", required: true, description: "the second number" },
  ],
  outputs: ["sum", "from"],
  steps: [
    {
      id: `${name}-cell`,
      kind: "cell",
      note: "# Adds two numbers\nUsed by other things.",
      code: `return { sum: inputs.a + inputs.b, from: '${marker}', secretWorkings: 'private' };`,
    },
  ],
});

console.log("\nwhat gets offered");

await check("a deployed notebook with a contract becomes a tool", async () => {
  const id = await store(adder("zz-cat-adder", "deployed"));
  await notebooksService.deploy(id, "test");

  const tool = (await tools()).find((entry) => entry.name === "run_zz_cat_adder");
  assert.ok(tool, "the notebook was not offered as a tool");
  assert.match(String(tool.description), /Adds two numbers/, "the note is not the description");
  assert.match(String(tool.description), /Returns: sum, from/);
});

await check("a notebook nobody deployed is not offered", async () => {
  await store(adder("zz-cat-undeployed", "draft"));
  const names = (await tools()).map((entry) => entry.name);
  assert.ok(!names.includes("run_zz_cat_undeployed"), "a draft was published as a tool");
});

await check("a notebook with no contract is not offered, because it cannot be described", async () => {
  const id = await store({
    id: "",
    name: "zz-cat-bare",
    runtime: "node",
    steps: [{ id: "zz-cat-bare-cell", kind: "cell", code: "return {};" }],
  });
  await notebooksService.deploy(id, "test");

  const names = (await tools()).map((entry) => entry.name);
  assert.ok(!names.includes("run_zz_cat_bare"), "a notebook with no contract was published");
});

await check("a name that is a title becomes a name that is an identifier", () => {
  assert.equal(toolNameFor("kurs USD → IDR"), "run_kurs_usd_idr");
  assert.equal(toolNameFor("  spaced  out  "), "run_spaced_out");
  assert.equal(toolNameFor("!!!"), "");
  return Promise.resolve();
});

console.log("\ncalling one");

await check("calling the tool returns the declared outputs and nothing else", async () => {
  const client = await connect();
  opened.push(client);

  const result = (await client.callTool({
    name: "run_zz_cat_adder",
    arguments: { a: 2, b: 40 },
  })) as unknown as ToolReply;

  assert.ok(!result.isError, result.content.map((part) => part.text).join("\n"));
  const outputs = JSON.parse(result.content.map((part) => part.text).join("\n"));
  assert.deepEqual(outputs, { sum: 42, from: "deployed" });
  assert.ok(!("secretWorkings" in outputs), "an undeclared name leaked through the tool");
});

await check("it runs the deployed version even once the draft has moved on", async () => {
  const found = await notebooksService.findByIdOrName("zz-cat-adder");
  assert.ok(found && found !== "ambiguous");
  await store({ ...adder("zz-cat-adder", "draft"), id: found.id });

  const client = await connect();
  opened.push(client);
  const result = (await client.callTool({
    name: "run_zz_cat_adder",
    arguments: { a: 1, b: 1 },
  })) as unknown as ToolReply;

  const outputs = JSON.parse(result.content.map((part) => part.text).join("\n"));
  assert.equal(outputs.from, "deployed", "the tool ran the draft");
});

await check("bad arguments come back as the contract's own complaint", async () => {
  const client = await connect();
  opened.push(client);

  const result = (await client.callTool({
    name: "run_zz_cat_adder",
    arguments: { a: 1 },
  })) as unknown as ToolReply;

  // Refused by the published schema before the notebook is even started, which is
  // better than refusing it inside the contract — the agent is told at the call site.
  assert.ok(result.isError, "a missing required argument was accepted");
  assert.match(result.content.map((part) => part.text).join("\n"), /\bb\b/);
});

await check("the run is recorded, and says an agent asked for it", async () => {
  const found = await notebooksService.findByIdOrName("zz-cat-adder");
  assert.ok(found && found !== "ambiguous");

  const runs = await notebookRunsService.listByNotebook(found.id, 5);
  assert.ok(
    runs.some((run) => run.trigger_source === "tool"),
    `expected a tool run, got ${runs.map((run) => run.trigger_source).join(", ")}`
  );
});

console.log("\nambiguity");

await check("two notebooks with one name publish neither, rather than a coin toss", async () => {
  // FX15: deploying refuses a second notebook under the *same* name, so the twins differ
  // in punctuation only — 'zz-cat-twin' and 'zz_cat_twin' are different names that
  // become one tool name, which is the collision the catalogue still has to survive.
  const first = await store(adder("zz-cat-twin", "one"));
  const second = await store(adder("zz_cat_twin", "two"));
  await notebooksService.deploy(first, "test");
  await notebooksService.deploy(second, "test");

  const names = (await tools()).map((entry) => entry.name);
  assert.equal(
    names.filter((name) => name === "run_zz_cat_twin").length,
    0,
    "one of two identically named notebooks was published anyway"
  );
});

for (const client of opened) await client.close().catch(() => {});
for (const id of created) await notebooksService.delete(id).catch(() => {});
await dropOwner("notebookcatalog");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

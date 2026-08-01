/**
 * M13 — can an agent find out how to do this?
 *
 * These checks exist because of a specific failure. `render` shipped with fourteen
 * passing tests and reached no agent: `notebook_write` never mentioned it, the
 * conventions resource carried only the workspace's house rules, and no stored notebook
 * used it. Asked for a chart, an agent drew one out of `█` characters — then said it
 * could not find the format and would not guess. It was right.
 *
 * Engine tests prove a capability works. Only these prove anyone was told, so every
 * capability an agent is expected to use should be asserted here as well as there.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/mcp-discoverability.test.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerNotebookTools } from "../src/mcp/notebook-tools.js";
import { registerConventions } from "../src/mcp/conventions.js";
import { OUTPUT_RENDERS, outputSpecs } from "../src/core/notebook-outputs.js";
import { EXAMPLE } from "../src/mcp/notebook-format.js";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";

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

await initDb();

const server = new McpServer({ name: "zaatool", version: "1.0.0" });
registerNotebookTools(server, { publishRunEvent: () => {}, writer: "test-agent" }, "author");
registerConventions(server);

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new Client({ name: "test-agent", version: "1.0.0" });
await client.connect(clientTransport);

const conventions = (await client.readResource({ uri: "zaa://conventions" })).contents
  .map((entry) => String((entry as { text?: string }).text ?? ""))
  .join("\n");

const tools = (await client.listTools()).tools;
const write = tools.find((tool) => tool.name === "notebook_write");

// ── the format is written down where an agent looks ───────────────────────────

console.log("\nthe conventions resource");

await check("names every render the parser actually accepts", () => {
  for (const render of OUTPUT_RENDERS) {
    assert.ok(
      conventions.includes(`\`${render}\``),
      `the conventions never mention the "${render}" render`
    );
  }
});

await check("shows an outputs block with render in it", () => {
  assert.match(conventions, /outputs:/);
  assert.match(conventions, /render: table/);
  assert.match(conventions, /render: chart/);
  assert.match(conventions, /x: month/);
});

await check("says what `auto` infers, so rows are known to be free", () => {
  assert.match(conventions, /array of objects is a table/i);
});

await check("says not to draw a chart out of text", () => {
  assert.match(conventions, /ASCII/i);
});

await check("still carries the workspace's own house rules", () => {
  assert.match(conventions, /House rules/);
});

await check("explains that inputs arrive under `inputs`, not as bare names", () => {
  assert.match(conventions, /inputs\.year/);
});

await check("lists the input options field, since prose cannot become a dropdown", () => {
  assert.match(conventions, /`options`/);
});

// ── the example is not just prose ─────────────────────────────────────────────

console.log("\nthe worked example");

await check("parses, so an agent that copies it gets a notebook that saves", () => {
  const document = fromMarkdown(EXAMPLE);
  assert.equal(document.name, "monthly-report");
  assert.equal(document.steps.length, 3, "the example should show more than one cell");
});

await check("declares the renders it is demonstrating", () => {
  const outputs = outputSpecs(fromMarkdown(EXAMPLE).outputs);
  assert.deepEqual(
    outputs.map((output) => [output.name, output.render]),
    [
      ["months", "table"],
      ["profit", "chart"],
      ["summary", "markdown"],
    ]
  );
  assert.equal(outputs[1].x, "month");
});

await check("compiles, so its cells are runnable as written", () => {
  const plan = compileNotebook(fromMarkdown(EXAMPLE));
  assert.deepEqual(plan.outputs, ["months", "profit", "summary"]);
});

await check("reads its declared input as `inputs.…`, the way it tells others to", () => {
  const code = fromMarkdown(EXAMPLE)
    .steps.map((step) => (step.kind === "cell" ? (step.code ?? "") : ""))
    .join("\n");
  assert.match(code, /inputs\.year/);
});

// ── and in the description of the tool that writes ────────────────────────────

console.log("\nthe write tool");

await check("mentions render and names the two shapes that need it", () => {
  const description = String(write?.description ?? "");
  assert.match(description, /render/);
  assert.match(description, /table/);
  assert.match(description, /chart/);
});

await check("forbids ASCII charts where the agent is already reading", () => {
  assert.match(String(write?.description ?? ""), /ASCII/i);
});

await check("points at the resource holding the rest", () => {
  assert.match(String(write?.description ?? ""), /zaa:\/\/conventions/);
});

await check("the resource is described by what it answers, not just its name", async () => {
  const resources = (await client.listResources()).resources;
  const entry = resources.find((resource) => resource.uri === "zaa://conventions");
  assert.ok(entry, "the conventions resource is not listed");
  assert.match(String(entry.description ?? ""), /chart|table|render/i);
});

await client.close().catch(() => {});
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

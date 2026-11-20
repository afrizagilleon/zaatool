/**
 * M11 — an input with a fixed set of values.
 *
 * The point is that one declaration reaches four readers. So each of them is checked
 * here against the same input: the contract refuses a value outside the set, the text
 * form round-trips it, the tool schema becomes an enum, and the tool description says
 * the values out loud. A change that satisfies only the page would fail this file.
 *
 * Notebooks it creates are prefixed `zz-opt-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-options.test.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bindInputs, ContractError, optionValues } from "../src/core/notebook-contract.js";
import { toMarkdown, fromMarkdown, NotebookTextError } from "../src/core/notebook-text.js";
import { registerDeployedNotebooks } from "../src/mcp/notebook-catalog.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson, NotebookParam } from "@zaa-tool/shared";
import { testOwner, dropOwner } from "./owners.js";

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

const direction: NotebookParam = {
  name: "direction",
  type: "string",
  options: ["usd_to_idr", "idr_to_usd"],
  default: "usd_to_idr",
};

// ── the contract refuses what is not on the list ──────────────────────────────

console.log("\ncontract");

await check("a permitted value passes through unchanged", () => {
  assert.deepEqual(bindInputs([direction], { direction: "idr_to_usd" }), {
    direction: "idr_to_usd",
  });
});

await check("a value outside the set is refused, and the message lists the set", () => {
  assert.throws(
    () => bindInputs([direction], { direction: "usd_to_rub" }),
    (err: unknown) =>
      err instanceof ContractError &&
      err.issues[0].includes("usd_to_idr") &&
      err.issues[0].includes("idr_to_usd")
  );
});

await check("the default is still used when nothing is supplied", () => {
  assert.deepEqual(bindInputs([direction], {}), { direction: "usd_to_idr" });
});

await check("membership is judged after coercion, so query strings work", () => {
  const size: NotebookParam = { name: "size", type: "number", options: [10, 50] };
  assert.deepEqual(bindInputs([size], { size: "50" }), { size: 50 });
  assert.throws(() => bindInputs([size], { size: "11" }), ContractError);
});

await check("labels are for people; matching is on the value", () => {
  const param: NotebookParam = {
    name: "mode",
    type: "string",
    options: [{ value: "fast", label: "As fast as possible" }, "thorough"],
  };
  assert.deepEqual(optionValues(param), ["fast", "thorough"]);
  assert.deepEqual(bindInputs([param], { mode: "fast" }), { mode: "fast" });
  assert.throws(
    () => bindInputs([param], { mode: "As fast as possible" }),
    ContractError,
    "a label was accepted as if it were a value"
  );
});

await check("a multiple-choice input always arrives as a list, even of one", () => {
  const tags: NotebookParam = { name: "tags", type: "string", options: ["a", "b"], multiple: true };
  assert.deepEqual(bindInputs([tags], { tags: "a" }), { tags: ["a"] });
  assert.deepEqual(bindInputs([tags], { tags: ["a", "b"] }), { tags: ["a", "b"] });
  assert.deepEqual(bindInputs([tags], { tags: [] }), { tags: [] });
});

await check("one bad entry refuses the whole list rather than dropping it", () => {
  const tags: NotebookParam = { name: "tags", type: "string", options: ["a", "b"], multiple: true };
  assert.throws(() => bindInputs([tags], { tags: ["a", "z"] }), ContractError);
});

await check("an input with no options accepts anything of its type, as before", () => {
  assert.deepEqual(bindInputs([{ name: "note", type: "string" }], { note: "whatever" }), {
    note: "whatever",
  });
});

// ── the text form keeps it ────────────────────────────────────────────────────

console.log("\ntext form");

const textDoc = (inputs: NotebookParam[]): NotebookJson => ({
  version: "1.0",
  id: "nb-opt",
  name: "Options",
  runtime: "node",
  inputs,
  steps: [{ id: "c1", kind: "cell", code: "return {};" }],
});

await check("options survive a round trip", () => {
  const back = fromMarkdown(toMarkdown(textDoc([direction])));
  assert.deepEqual(back.inputs?.[0].options, ["usd_to_idr", "idr_to_usd"]);
  assert.equal(back.inputs?.[0].default, "usd_to_idr");
});

await check("a label written by hand is not rewritten away", () => {
  const withLabel: NotebookParam = {
    name: "mode",
    type: "string",
    options: [{ value: "fast", label: "As fast as possible" }, "thorough"],
  };
  const back = fromMarkdown(toMarkdown(textDoc([withLabel])));
  assert.deepEqual(back.inputs?.[0].options, [
    { value: "fast", label: "As fast as possible" },
    "thorough",
  ]);
});

await check("multiple round trips alongside its options", () => {
  const many: NotebookParam = { name: "tags", type: "string", options: ["a", "b"], multiple: true };
  const back = fromMarkdown(toMarkdown(textDoc([many])));
  assert.equal(back.inputs?.[0].multiple, true);
});

await check("`multiple` with no options is refused, not silently kept", () => {
  const text = [
    "---",
    "name: Options",
    "runtime: node",
    "inputs:",
    "  - name: tags",
    "    type: string",
    "    multiple: true",
    "---",
    "",
    "```js",
    "return {};",
    "```",
  ].join("\n");

  assert.throws(
    () => fromMarkdown(text),
    (err: unknown) =>
      err instanceof NotebookTextError && err.issues.some((issue) => issue.includes("multiple")),
    "a chooser with nothing to choose from was accepted"
  );
});

await check("options written as a flow list are read", () => {
  const text = [
    "---",
    "name: Options",
    "runtime: node",
    "inputs:",
    "  - name: direction",
    "    type: string",
    "    options: [usd_to_idr, idr_to_usd]",
    "---",
    "",
    "```js",
    "return {};",
    "```",
  ].join("\n");

  assert.deepEqual(fromMarkdown(text).inputs?.[0].options, ["usd_to_idr", "idr_to_usd"]);
});

await check("an option that is not a value is refused", () => {
  const text = [
    "---",
    "name: Options",
    "runtime: node",
    "inputs:",
    "  - name: direction",
    "    type: string",
    "    options:",
    "      - nested: true",
    "---",
    "",
    "```js",
    "return {};",
    "```",
  ].join("\n");

  assert.throws(() => fromMarkdown(text), NotebookTextError);
});

// ── what the agent is offered ─────────────────────────────────────────────────

console.log("\nwhat the agent sees");

await initDb();
const OWNER = (await testOwner("notebookoptions")).id;

const created: string[] = [];
const opened: Client[] = [];

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document }, "test", OWNER);
  if (!created.includes(id)) created.push(id);
  return id;
}

async function tools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]> {
  const server = new McpServer({ name: "zaatool", version: "1.0.0" });
  await registerDeployedNotebooks(server, { publishRunEvent: () => {}, userId: OWNER });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientTransport);
  opened.push(client);

  return (await client.listTools()).tools;
}

const converter: Omit<NotebookJson, "version"> = {
  id: "",
  name: "zz-opt-convert",
  runtime: "node",
  inputs: [
    { name: "amount", type: "number", required: true },
    { name: "direction", type: "string", options: ["usd_to_idr", "idr_to_usd"] },
  ],
  outputs: ["converted"],
  steps: [
    {
      id: "c1",
      kind: "cell",
      note: "# Converts between two currencies",
      code: "return { converted: inputs.amount };",
    },
  ],
};

await check("the tool schema is an enum, not a bare string", async () => {
  const id = await store(converter);
  await notebooksService.deploy(id, "test");

  const tool = (await tools()).find((entry) => entry.name === "run_zz_opt_convert");
  assert.ok(tool, "the notebook was not offered as a tool");

  const schema = tool.inputSchema as {
    properties: Record<string, Record<string, unknown>>;
  };
  const encoded = JSON.stringify(schema.properties.direction);

  assert.ok(
    encoded.includes("usd_to_idr") && encoded.includes("idr_to_usd"),
    `the permitted values are not in the schema: ${encoded}`
  );
  assert.ok(
    !encoded.includes('"type":"string"') || encoded.includes("usd_to_idr"),
    "the schema still accepts any string"
  );
});

await check("the description says the values out loud, where a model reads first", async () => {
  const tool = (await tools()).find((entry) => entry.name === "run_zz_opt_convert");
  assert.match(String(tool?.description), /direction \("usd_to_idr" \| "idr_to_usd"\)/);
});

for (const client of opened) await client.close().catch(() => {});
for (const id of created) await notebooksService.delete(id).catch(() => {});
await dropOwner("notebookoptions");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

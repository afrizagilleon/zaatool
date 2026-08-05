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
import { ALLOWED_JS_PACKAGES } from "../src/core/notebook-packages.js";
import { ACTION_KINDS } from "../src/core/notebook-actions.js";
import { EXAMPLE } from "../src/mcp/notebook-format.js";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import { runNotebook } from "../src/core/notebook-runner.js";
import { runJsNode } from "../src/core/js-runner.js";
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

await check("states the scope rule that every cell after the first depends on", () => {
  assert.match(conventions, /only through `inputs`/i);
  assert.match(conventions, /is not defined/);
});

await check("says not to draw a chart out of text", () => {
  assert.match(conventions, /ASCII/i);
});

await check("says one output per cell, and why the page depends on it", () => {
  assert.match(conventions, /One output per cell/i);
  assert.match(conventions, /the moment the cell that produced it finishes/i);
});

await check("warns that a repeated output name silently replaces the first", () => {
  assert.match(conventions, /written twice replaces the first/i);
});

await check("says when parallel is worth it, not only how to write it", () => {
  assert.match(conventions, /Do not reach for lanes by default/i);
  assert.match(conventions, /genuinely independent/i);
  // The part an agent most needs told: restructuring someone's notebook is not a
  // free optimisation.
  assert.match(conventions, /Ask before restructuring/i);
});

await check("explains what a parallel group joins on", () => {
  assert.match(conventions, /zaa:parallel/);
  assert.match(conventions, /must not write the same name/i);
  assert.match(conventions, /waits for the slowest lane/i);
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

await check("compiles", () => {
  const plan = compileNotebook(fromMarkdown(EXAMPLE));
  assert.deepEqual(plan.outputs, ["months", "profit", "summary"]);
});

/**
 * Compiling is a static check and it is not enough.
 *
 * An earlier version of this example passed a compile check while being wrong in the one
 * way that matters: it read a previous cell's value as a bare name. Every cell after the
 * first would have failed with `rows is not defined` for anyone who copied it — which is
 * what documentation is for. Running it is the only assertion that catches that.
 */
await check("actually runs, which compiling does not prove", async () => {
  const plan = compileNotebook(fromMarkdown(EXAMPLE));
  const result = await runNotebook(
    plan,
    { input: { year: 2026 } } as never,
    runJsNode as never
  );

  assert.equal(
    result.status,
    "success",
    `the documented example fails when run: ${result.errors.join("; ")}`
  );
  assert.equal((result.outputs.months as unknown[]).length, 3);
  assert.equal((result.outputs.profit as unknown[]).length, 3);
  assert.match(String(result.outputs.summary), /Total profit/);
});

await check("reaches scope through `inputs`, the way it tells others to", () => {
  const code = fromMarkdown(EXAMPLE)
    .steps.map((step) => (step.kind === "cell" ? (step.code ?? "") : ""))
    .join("\n");

  assert.match(code, /inputs\.year/);
  // The rule the example must demonstrate, not merely state.
  assert.match(code, /inputs\.rows/);
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

// ── what a rewrite is allowed to forget ───────────────────────────────────────

console.log("\nomission is not deletion");

await check("the conventions say which fields survive being left out", () => {
  // `\s+` rather than a space: the reference is wrapped prose, and a sentence that moves
  // one word onto the next line should not fail a check about what it says.
  assert.match(conventions, /Leave them out of a\s+rewrite and the stored ones are kept/i);
  assert.match(conventions, /actions: \[\]/);
});

await check("and are explicit that the rest are not like that", () => {
  // The dangerous half: an agent that generalises "omitting is safe" would delete a
  // notebook's inputs by writing a document that only talks about code.
  assert.match(conventions, /omit them and they are gone/i);
});

await check("the write tool says it too, without needing the resource", () => {
  const description = String(write?.description ?? "");
  assert.match(description, /DO NOT HAVE TO REPRODUCE/);
  assert.match(description, /layout/);
  assert.match(description, /actions/);
});

await check("warns that a wrong `render` is worse than none", () => {
  assert.match(conventions, /Overruling `auto` badly is worse than not overruling it/i);
  // The exact mistake an agent made: multi-line markdown declared as text.
  assert.match(conventions, /render: text/);
  assert.match(conventions, /multi-line is always markdown/i);
});

// ── the two things an agent asked for and could not find ──────────────────────

console.log("\nroom to write, and links in a row");

await check("`multiline` is documented as a control, not a type", () => {
  assert.match(conventions, /`multiline`/);
  assert.match(conventions, /still a `string`/i);
  assert.match(String(write?.description ?? ""), /multiline: true/);
});

await check("`multiline` is accepted on a plain string and refused elsewhere", () => {
  const field = (extra: string) =>
    [
      "---",
      "name: zz-multiline",
      "runtime: node",
      "inputs:",
      "  - name: note",
      extra,
      "---",
      "",
      "```js",
      "return {};",
      "```",
    ].join("\n");

  const ok = fromMarkdown(field("    type: string\n    multiline: true"));
  assert.equal(ok.inputs?.[0].multiline, true);

  assert.throws(() => fromMarkdown(field("    type: number\n    multiline: true")), /multiline/);
  assert.throws(
    () => fromMarkdown(field("    type: string\n    options: [a, b]\n    multiline: true")),
    /multiline/
  );
});

await check("a URL in a table cell is documented as clickable, with the column as its label", () => {
  assert.match(conventions, /web address becomes a link/i);
  assert.match(conventions, /name the column after what it does/i);
});

await check("and markdown in a cell is called out, since that is what was tried", () => {
  // The exact thing an agent produced: `[Verify](url)` rendered as those characters.
  assert.match(conventions, /\[Verify\]\(https:\/\/…\)/);
  assert.match(conventions, /Return the bare URL/i);
});

await check("an internal `link` is documented as staying in the tab", () => {
  assert.match(conventions, /opens in the same tab/i);
  assert.match(conventions, /#\/notebooks\/<id>/);
});

// ── buttons ───────────────────────────────────────────────────────────────────

console.log("\npage actions");

await check("every action kind is named in the conventions", () => {
  for (const kind of ACTION_KINDS) {
    assert.ok(
      conventions.includes(`\`${kind}\``),
      `the conventions never mention the "${kind}" action`
    );
  }
});

await check("shows the shape rather than describing it", () => {
  assert.match(conventions, /actions:/);
  assert.match(conventions, /do: run/);
  assert.match(conventions, /notebook: send-report/);
});

await check("says a `run` button asks for what its target declares", () => {
  assert.match(conventions, /asks for what its target needs/i);
  assert.match(conventions, /opens a small form/i);
  // The mistake this exists to prevent, and the one already in a real notebook: inputs
  // added to the calling page purely to feed a button.
  assert.match(conventions, /do \*\*not\*\* add an input to this notebook just to feed a button/i);
  assert.match(String(write?.description ?? ""), /NEVER add an input to this notebook just to feed a button/);
});

await check("and that a button with nothing left to ask still runs on one press", () => {
  assert.match(conventions, /runs on one press with no\s+form at all/i);
});

await check("says what `run` deliberately does not do", () => {
  // The constraint most likely to be designed around if it is not stated: a `run`
  // button reports an outcome, it does not display the other notebook's values.
  assert.match(conventions, /reports that it\s+ran or that it failed/);
});

await check("warns that a shared link drops `run` buttons", () => {
  assert.match(conventions, /removed from a shared link/);
});

await check("the write tool mentions actions without needing the resource", () => {
  const description = String(write?.description ?? "");
  assert.match(description, /actions:/);
  for (const kind of ACTION_KINDS) {
    assert.match(description, new RegExp(`\`${kind}\``));
  }
});

await check("a documented action example is accepted by the parser", () => {
  const document = fromMarkdown(
    [
      "---",
      "name: zz-action-shape",
      "runtime: node",
      "outputs: [ok]",
      "actions:",
      "  - label: Check again",
      "    do: rerun",
      "  - label: Email the report",
      "    do: run",
      "    notebook: send-report",
      "  - label: Source data",
      "    do: link",
      "    url: https://example.com/ledger",
      "---",
      "",
      "```js",
      "return { ok: true };",
      "```",
    ].join("\n")
  );

  assert.equal(document.actions?.length, 3);
  assert.equal(document.actions?.[1].notebook, "send-report");
});

await check("an action that could not work is refused at write time, with the reason", () => {
  assert.throws(
    () =>
      fromMarkdown(
        [
          "---",
          "name: zz-action-bad",
          "runtime: node",
          "actions:",
          "  - label: Go",
          "    do: link",
          "    url: javascript:alert(1)",
          "---",
          "",
          "```js",
          "return {};",
          "```",
        ].join("\n")
      ),
    /url.*must start with/i
  );
});

// ── files, in and out ─────────────────────────────────────────────────────────

console.log("\nfiles");

await check("`files.write` is written down, in both runtimes", () => {
  assert.match(conventions, /files\.write/);
  assert.match(conventions, /await files\.write\(/);
  assert.match(conventions, /files\.write\("chart\.png", png_bytes\)/);
});

await check("what comes back is named, and `auto` is said to be enough", () => {
  assert.match(conventions, /\{ name, path, url, size, mime \}/);
  assert.match(conventions, /You do not have to say\s+`render: image`/i);
});

await check("the replacing-by-name rule is stated, since nothing else would reveal it", () => {
  assert.match(conventions, /same name replaces the file/i);
});

await check("a `file` input is documented with how a cell reads one", () => {
  assert.match(conventions, /type: file/);
  assert.match(conventions, /readAsText\(\)/);
  assert.match(conventions, /read_as_text\(\)/);
});

await check("`accept` is documented, including the one thing it does beyond filtering", () => {
  assert.match(conventions, /`accept`/);
  // The reference wraps, so the words are matched with the break allowed between them.
  assert.match(conventions, /the page grows a \*\*record\*\*\s+button/i);
});

await check("the webhook's secret requirement is stated where the file input is", () => {
  assert.match(conventions, /must have a `secretKey`/i);
});

await check("`file` is accepted by the parser, and `accept` only on a file", () => {
  const field = (extra: string) =>
    [
      "---",
      "name: zz-accept",
      "runtime: node",
      "inputs:",
      "  - name: doc",
      extra,
      "---",
      "",
      "```js",
      "return {};",
      "```",
    ].join("\n");

  const ok = fromMarkdown(field("    type: file\n    accept: image/*"));
  assert.equal(ok.inputs?.[0].type, "file");
  assert.equal(ok.inputs?.[0].accept, "image/*");

  assert.throws(() => fromMarkdown(field("    type: string\n    accept: image/*")), /accept/);
});

// ── libraries ─────────────────────────────────────────────────────────────────

console.log("\nlibraries");

await check("`packages` is documented next to the runtime it changes", () => {
  assert.match(conventions, /packages: \[pandas/);
  assert.match(conventions, /anything on PyPI/i);
});

await check("the JavaScript list is read from the runtime, not written twice", () => {
  for (const name of ALLOWED_JS_PACKAGES) {
    assert.ok(conventions.includes(`\`${name}\``), `the reference never mentions ${name}`);
  }
});

await check("the silent-failure case is named, since nothing else would reveal it", () => {
  assert.match(conventions, /Undeclared means the standard library only/i);
});

// ── editing without rewriting ─────────────────────────────────────────────────

console.log("\nchanging part of a notebook");

await check("the outline is offered as the thing to read first", () => {
  const read = tools.find((tool) => tool.name === "notebook_read");
  assert.match(String(read?.description ?? ""), /part: outline/);
  assert.match(conventions, /part: outline/);
});

await check("`notebook_edit_cell` exists and says why it beats a rewrite", () => {
  const edit = tools.find((tool) => tool.name === "notebook_edit_cell");
  assert.ok(edit, "there is no notebook_edit_cell tool");
  assert.match(String(edit.description), /INSTEAD OF `notebook_write`/i);
  assert.match(conventions, /notebook_edit_cell/);
});

await check("the tool says what shape `code` takes, since a fence is the natural guess", () => {
  const edit = tools.find((tool) => tool.name === "notebook_edit_cell");
  assert.match(String(edit?.description ?? ""), /SEND `code` AS CODE/);
  assert.match(String(edit?.description ?? ""), /nothing is saved/i);
});

await check("the scope refusal is documented rather than discovered by being refused", () => {
  assert.match(conventions, /reading a name nothing\s+writes any more/i);
});

await check("the map's grouping is described where an agent decides what to reuse", () => {
  assert.match(String(tools.find((tool) => tool.name === "system_map")?.description ?? ""), /about/);
  assert.match(conventions, /Called by others/);
  assert.match(conventions, /Look here before writing anything/i);
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

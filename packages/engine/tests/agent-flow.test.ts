/**
 * FX1 — the whole job an agent is actually asked to do, over a real MCP client.
 *
 * Every other test here calls a function. This one connects a client to the server, lists
 * the tools the way an agent lists them, and does the two things that failed: change one
 * cell, and move one tile. If it passes, the sequence works end to end; if a tool is
 * registered but unreachable, or its schema refuses an argument an agent would send, only
 * this file notices.
 *
 * The claim under test is not "the tools exist". It is **that changing one thing changes
 * one thing** — the rest of the notebook comes out byte for byte identical, which is the
 * property `notebook_write` could never offer and the reason any of this was built.
 *
 * Notebooks it creates are prefixed `zz-flow-` and left behind.
 *
 *   pnpm --filter @zaa-tool/engine test agent-flow
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerNotebookTools } from "../src/mcp/notebook-tools.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { fromMarkdown, toMarkdown } from "../src/core/notebook-text.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
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

await initDb();
const OWNER = (await testOwner("agentflow")).id;

const server = new McpServer({ name: "zaatool", version: "1.0.0" });
registerNotebookTools(server, { publishRunEvent: () => {}, writer: "zz-flow-agent", userId: OWNER }, "author");

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "test-agent", version: "1.0.0" });
await client.connect(clientTransport);

/** Calls a tool the way an agent does, and hands back the text it would read. */
async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return result.content.map((entry) => entry.text).join("\n");
}

const BACKTICK = "`";
const FENCE = BACKTICK.repeat(3);
const NAME = "zz-flow-report";

/** A notebook with the shape that matters: several cells, a contract, and an arrangement. */
const SOURCE = [
  "---",
  `name: ${NAME}`,
  "id: zz-flow-report-id",
  "runtime: node",
  "inputs:",
  "  - name: year",
  "    type: number",
  "    default: 2026",
  "outputs:",
  "  - name: months",
  "    render: table",
  "  - name: total",
  "layout:",
  "  - { i: months, x: 0, y: 0, w: 8, h: 4 }",
  "  - { i: total, x: 8, y: 0, w: 4, h: 4 }",
  "---",
  "",
  "<!-- zaa:cell id=zz-flow-fetch -->",
  "Fetch the months.",
  "<!-- zaa:code -->",
  "```js",
  "const months = [{ month: 'Jan', profit: 10 }, { month: 'Feb', profit: 20 }];",
  "return { months, year: inputs.year };",
  "```",
  "",
  "<!-- zaa:cell id=zz-flow-total -->",
  "Add them up.",
  "<!-- zaa:code -->",
  "```js",
  "return { total: inputs.months.reduce((sum, m) => sum + m.profit, 0) };",
  "```",
].join("\n");

await notebooksService.save(fromMarkdown(SOURCE), "test", OWNER);
// Kept between runs, so the owner from the last run is gone: put it back on this run's.
await pool.query("UPDATE notebooks SET owner_id = $1 WHERE name = $2", [OWNER, NAME]);

// Fixtures are kept between runs — so this file has to put the notebook back to the state
// it assumes, or the second run reads the first run's deployment and the diff checks below
// answer a different question than the one they ask.
{
  const found = await notebooksService.findByIdOrName(NAME);
  if (found && found !== "ambiguous") await notebooksService.undeploy(found.id).catch(() => {});
}

/** The stored document, as text — the thing that must not change when it should not. */
async function stored(): Promise<string> {
  const found = await notebooksService.findByIdOrName(NAME);
  assert.ok(found && found !== "ambiguous");
  return toMarkdown(notebooksService.parseDocument(found));
}

// ── what an agent can find ────────────────────────────────────────────────────

console.log("\nthe tools an agent lists");

await check("every tool this milestone added is reachable", async () => {
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  for (const wanted of ["notebook_read", "notebook_edit_cell", "notebook_edit_setup", "notebook_diff"]) {
    assert.ok(names.includes(wanted), `${wanted} is not listed`);
  }
});

// ── reading, at each size ─────────────────────────────────────────────────────

console.log("\nreading only as much as the job needs");

await check("outline carries no code, and the full text does", async () => {
  const outline = await call("notebook_read", { notebook: NAME, part: "outline" });
  const full = await call("notebook_read", { notebook: NAME, part: "full" });

  assert.ok(!outline.includes("reduce"), "the outline leaked code");
  assert.ok(full.includes("reduce"), "the full text has no code in it");
  assert.ok(outline.length < full.length / 2, "the outline is not meaningfully smaller");
});

await check("one cell comes with the names in scope where it sits", async () => {
  const cell = await call("notebook_read", { notebook: NAME, part: "cell", cell: "zz-flow-total" });

  assert.ok(cell.includes("reduce"), "the cell's own code is missing");
  assert.ok(!cell.includes("Fetch the months"), "it returned a neighbouring cell too");
  // The thing that makes reading one cell safe rather than a guess.
  assert.match(cell, /in scope here:.*months/);
  assert.match(cell, /in scope here:.*year/);
  assert.match(cell, /this cell writes: total/);
  // `total` is a declared output, so it must keep being written.
  assert.match(cell, /must keep writing:.*total/);
});

await check("a cell can be named by position, like notebook_run_cell", async () => {
  const byPosition = await call("notebook_read", { notebook: NAME, part: "cell", cell: "2" });
  assert.ok(byPosition.includes("zz-flow-total"), byPosition.slice(0, 200));
});

await check("setup carries the declaration and draws the layout", async () => {
  const setup = await call("notebook_read", { notebook: NAME, part: "setup" });

  assert.ok(!setup.includes("reduce"), "setup leaked code");
  assert.match(setup, /A = months/);
  assert.match(setup, /B = total/);
  // The grid picture, not the coordinates dumped.
  assert.match(setup, /\|A{8}B{4}\|/);
});

// ── changing one cell ─────────────────────────────────────────────────────────

console.log("\nchanging one cell changes one cell");

await check("the call that used to fail — fenced code — now works", async () => {
  const before = await stored();

  const sent = `${FENCE}js\nreturn { total: inputs.months.reduce((sum, m) => sum + m.profit, 0) * 2 };\n${FENCE}`;
  const answer = await call("notebook_edit_cell", {
    notebook: NAME,
    action: "replace",
    cell: "zz-flow-total",
    code: sent,
  });

  assert.match(answer, /replace on/);
  // What was stored is shown back, so a difference between sent and kept is visible.
  assert.match(answer, /Stored:/);

  // Checked on the *cell's code*, not on the serialized markdown — `toMarkdown` writes a
  // fence around every cell by design, so searching the text would prove nothing.
  const found = await notebooksService.findByIdOrName(NAME);
  assert.ok(found && found !== "ambiguous");
  const cell = notebooksService
    .parseDocument(found)
    .steps.find((step) => step.kind === "cell" && step.id === "zz-flow-total");
  assert.ok(cell && cell.kind === "cell");
  assert.ok(!cell.code?.includes(FENCE), "a fence reached the cell's code");
  assert.ok(cell.code?.includes("* 2"), "the edit did not land");

  const after = await stored();

  // The whole point: the other cell is untouched, character for character.
  const otherCell = (text: string) => text.slice(text.indexOf("Fetch the months"), text.indexOf("<!-- zaa:cell id=zz-flow-total"));
  assert.equal(otherCell(after), otherCell(before), "an untouched cell changed anyway");
});

await check("an edit that does not parse changes nothing at all", async () => {
  const before = await stored();
  const answer = await call("notebook_edit_cell", {
    notebook: NAME,
    action: "replace",
    cell: "zz-flow-total",
    code: "return { total: ;",
  });

  assert.match(answer, /does not parse/);
  assert.equal(await stored(), before, "a refused edit was saved anyway");
});

await check("dry_run reports and saves nothing", async () => {
  const before = await stored();
  const answer = await call("notebook_edit_cell", {
    notebook: NAME,
    action: "append",
    code: "return { extra: 1 };",
    dry_run: true,
  });

  assert.match(answer, /Nothing was saved/);
  assert.equal(await stored(), before, "a dry run wrote to the document");
});

await check("deleting a cell something below depends on is refused", async () => {
  const answer = await call("notebook_edit_cell", {
    notebook: NAME,
    action: "delete",
    cell: "zz-flow-fetch",
  });
  assert.match(answer, /months/);
});

// ── moving a tile ─────────────────────────────────────────────────────────────

console.log("\nmoving a tile without touching a cell");

await check("layout changes and every cell comes out identical", async () => {
  const before = await stored();
  const cellsOf = (text: string) => text.slice(text.indexOf("<!-- zaa:cell"));

  const answer = await call("notebook_edit_setup", {
    notebook: NAME,
    key: "layout",
    value: JSON.stringify([
      { i: "months", x: 0, y: 0, w: 12, h: 3 },
      { i: "total", x: 0, y: 3, w: 12, h: 2 },
    ]),
  });

  assert.match(answer, /No cell was touched/);
  // Answered with the new arrangement drawn, so the result is visible without a re-read.
  assert.match(answer, /\|A{12}\|/);

  const after = await stored();
  assert.equal(cellsOf(after), cellsOf(before), "a cell changed while moving a tile");
  assert.ok(after.includes("w: 12"), "the layout did not change");
});

await check("a layout that runs off the grid is refused", async () => {
  const answer = await call("notebook_edit_setup", {
    notebook: NAME,
    key: "layout",
    value: JSON.stringify([{ i: "months", x: 8, y: 0, w: 8, h: 2 }]),
  });
  assert.match(answer, /past column 12/);
});

await check("an input can be added without sending a single cell", async () => {
  const before = await stored();
  const cellsOf = (text: string) => text.slice(text.indexOf("<!-- zaa:cell"));

  await call("notebook_edit_setup", {
    notebook: NAME,
    key: "inputs",
    value: JSON.stringify([
      { name: "year", type: "number", default: 2026 },
      { name: "note", type: "string", multiline: true },
    ]),
  });

  const after = await stored();
  assert.ok(after.includes("multiline"), "the new input is not there");
  assert.equal(cellsOf(after), cellsOf(before), "a cell changed while adding an input");
});

await check("a declaration the parser refuses is not saved", async () => {
  const before = await stored();
  // `accept` only applies to a file, and the parser is what knows that — the point being
  // that this refusal comes from the same place `notebook_write`'s does.
  const answer = await call("notebook_edit_setup", {
    notebook: NAME,
    key: "inputs",
    value: JSON.stringify([{ name: "year", type: "number", accept: "image/*" }]),
  });

  assert.match(answer, /accept/);
  assert.equal(await stored(), before, "a refused declaration was saved anyway");
});

await check("packages a JavaScript cell may not have are refused here too", async () => {
  const answer = await call("notebook_edit_setup", {
    notebook: NAME,
    key: "packages",
    value: JSON.stringify(["pg"]),
  });
  assert.match(answer, /not available to JavaScript/);
});

// ── what differs from production ──────────────────────────────────────────────

console.log("\nbefore asking anyone to deploy");

await check("an undeployed notebook says so rather than pretending", async () => {
  const answer = await call("notebook_diff", { notebook: NAME });
  assert.match(answer, /never been deployed/);
});

await check("after deploying, the diff names what moved", async () => {
  const found = await notebooksService.findByIdOrName(NAME);
  assert.ok(found && found !== "ambiguous");
  await notebooksService.deploy(found.id, "test");

  assert.match(await call("notebook_diff", { notebook: NAME }), /exactly what is deployed/);

  await call("notebook_edit_cell", {
    notebook: NAME,
    action: "replace",
    cell: "zz-flow-fetch",
    note: "Fetch the months, from the ledger.",
  });

  const answer = await call("notebook_diff", { notebook: NAME });
  assert.match(answer, /note\s+`zz-flow-fetch`/);
  assert.ok(!answer.includes("zz-flow-total"), "an untouched cell was reported as changed");
});

// ── the nudge ─────────────────────────────────────────────────────────────────

console.log("\nbeing told there was a smaller way");

await check("a rewrite that changed one cell says which call was smaller", async () => {
  const document = fromMarkdown(await call("notebook_read", { notebook: NAME, part: "full" }));
  const target = document.steps.find((step) => step.kind === "cell" && step.id === "zz-flow-total");
  assert.ok(target && target.kind === "cell");
  target.code = "return { total: 99 };";

  const answer = await call("notebook_write", { text: toMarkdown(document) });
  assert.match(answer, /notebook_edit_cell/);
  assert.match(answer, /zz-flow-total/);
});

await check("a rewrite that changed only a declaration points at edit_setup", async () => {
  const document = fromMarkdown(await call("notebook_read", { notebook: NAME, part: "full" }));
  document.secrets = ["ZZ_FLOW_KEY"];

  const answer = await call("notebook_write", { text: toMarkdown(document) });
  assert.match(answer, /notebook_edit_setup/);
  assert.match(answer, /secrets/);
});

await client.close().catch(() => {});
await dropOwner("agentflow");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

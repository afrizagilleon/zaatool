/**
 * FX1, shown on a real notebook rather than a fixture.
 *
 * Copies `daily-exchange-monitor` — six cells, two lanes, a contract, buttons — into
 * `zz-fx1-demo`, then does the two things that failed, over a real MCP client. Your own
 * notebook is never written to.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/fx1-demo.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerNotebookTools } from "../src/mcp/notebook-tools.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { fromMarkdown, toMarkdown } from "../src/core/notebook-text.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";

await initDb();

const server = new McpServer({ name: "zaatool", version: "1.0.0" });
registerNotebookTools(server, { publishRunEvent: () => {}, writer: "zz-fx1-demo" }, "author");
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "demo", version: "1.0.0" });
await client.connect(clientTransport);

const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return result.content.map((entry) => entry.text).join("\n");
};

// ── a copy of the real thing ──────────────────────────────────────────────────

const original = await notebooksService.findByIdOrName("daily-exchange-monitor");
if (!original || original === "ambiguous") throw new Error("daily-exchange-monitor not found");

const source = toMarkdown(notebooksService.parseDocument(original))
  .replace(/^name: .*$/m, "name: zz-fx1-demo")
  .replace(/^id: .*$/m, "id: zz-fx1-demo-id");

await notebooksService.save(fromMarkdown(source), "zz-fx1-demo");

const textOf = async (): Promise<string> => {
  const found = await notebooksService.findByIdOrName("zz-fx1-demo");
  if (!found || found === "ambiguous") throw new Error("copy missing");
  return toMarkdown(notebooksService.parseDocument(found));
};
const cellsOf = (text: string) => text.slice(text.indexOf("<!-- zaa:cell"));

const rule = (title: string) => console.log(`\n${"─".repeat(72)}\n${title}\n`);

// ── what it costs to read ─────────────────────────────────────────────────────

const full = await call("notebook_read", { notebook: "zz-fx1-demo", part: "full" });
const outline = await call("notebook_read", { notebook: "zz-fx1-demo", part: "outline" });
const setup = await call("notebook_read", { notebook: "zz-fx1-demo", part: "setup" });
const one = await call("notebook_read", { notebook: "zz-fx1-demo", part: "cell", cell: "2" });

rule("What each `part` costs, on a real six-cell notebook");
const tokens = (text: string) => Math.round(text.length / 4);
for (const [label, text] of [
  ["full", full],
  ["outline", outline],
  ["setup", setup],
  ["cell (one)", one],
] as const) {
  const share = ((text.length / full.length) * 100).toFixed(0);
  console.log(`  ${label.padEnd(12)} ${String(tokens(text)).padStart(5)} tokens   ${share.padStart(3)}% of full`);
}

rule("`part: setup` — the layout, drawn");
console.log(setup.slice(setup.indexOf("layout:")));

rule("`part: cell` — one cell, with the names in scope there");
console.log(one);

// ── changing one cell ─────────────────────────────────────────────────────────

rule("Changing one cell, with the fenced code that used to fail");

const before = await textOf();
const cellId = /`([^`]+)`/.exec(outline.split("\n").find((line) => line.startsWith("- `")) ?? "")?.[1];

const answer = await call("notebook_edit_cell", {
  notebook: "zz-fx1-demo",
  action: "replace",
  cell: cellId ?? "1",
  code: "```js\nconst rate_idr = 16240;\nreturn { rate_idr, source_idr: 'demo', timestamp: new Date().toISOString() };\n```",
});
console.log(answer.split("\n").slice(0, 3).join("\n"));
console.log(answer.slice(answer.indexOf("Stored:")));

const afterCell = await textOf();
const untouched = (text: string) => text.slice(text.indexOf("<!-- zaa:cell id=display-usd-idr"));
console.log(
  `\n  every other cell identical: ${untouched(afterCell) === untouched(before) ? "yes" : "NO"}`
);

// ── moving a tile ─────────────────────────────────────────────────────────────

rule("Moving a tile — no cell is sent at all");

const beforeLayout = await textOf();
const moved = await call("notebook_edit_setup", {
  notebook: "zz-fx1-demo",
  key: "layout",
  value: JSON.stringify([
    { i: "usd_idr_display", x: 0, y: 0, w: 12, h: 2 },
    { i: "usd_eur_display", x: 0, y: 2, w: 6, h: 2 },
    { i: "comparison_table", x: 6, y: 2, w: 6, h: 2 },
    { i: "action_panel", x: 0, y: 4, w: 12, h: 2 },
  ]),
});
console.log(moved.slice(0, moved.indexOf("inputs:")));
console.log(moved.slice(moved.indexOf("layout:"), moved.indexOf("Change one of these")));

const afterLayout = await textOf();
console.log(
  `  every cell identical: ${cellsOf(afterLayout) === cellsOf(beforeLayout) ? "yes" : "NO"}`
);

// ── what it refuses ───────────────────────────────────────────────────────────

rule("What it refuses, and saves nothing for");

const beforeRefusals = await textOf();
for (const [what, args] of [
  ["code that does not parse", { action: "replace", cell: cellId ?? "1", code: "return { a: ;" }],
  ["half a fence", { action: "replace", cell: cellId ?? "1", code: "```js\nreturn { a: 1 };" }],
  ["a tile off the grid", { key: "layout", value: '[{"i":"x","x":8,"y":0,"w":8,"h":2}]' }],
  ["a package a JS cell may not have", { key: "packages", value: '["pg"]' }],
] as const) {
  const tool = "key" in args ? "notebook_edit_setup" : "notebook_edit_cell";
  const said = await call(tool, { notebook: "zz-fx1-demo", ...args });
  console.log(`  ${what.padEnd(32)} → ${said.split("\n")[0].slice(0, 80)}`);
}
console.log(
  `\n  document unchanged after all four: ${(await textOf()) === beforeRefusals ? "yes" : "NO"}`
);

await client.close().catch(() => {});
await pool.end();
console.log("\nYour own notebook was never written to. The copy is `zz-fx1-demo`.\n");

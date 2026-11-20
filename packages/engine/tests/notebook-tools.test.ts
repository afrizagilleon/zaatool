/**
 * FX12 T-03 and T-04 — the two things the contract changed about reading and writing.
 *
 * Both are driven through a real MCP client over an in-memory transport, because both
 * live inside the tool handlers rather than in a function that can be imported: the
 * default for `part` is a `??` inside `notebook_read`, and the etag check is a guard
 * inside three write handlers. A test that only called the service underneath would
 * pass with either change reverted, which is exactly what the first version of this
 * file did.
 *
 * Notebooks it creates are prefixed `zz-fx12-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-tools.test.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerNotebookTools } from "../src/mcp/notebook-tools.js";
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
const OWNER = (await testOwner("notebooktools")).id;

const server = new McpServer({ name: "zaatool", version: "1.0.0" });
registerNotebookTools(server, { publishRunEvent: () => {}, writer: "test-agent", userId: OWNER }, "author");
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "test-agent", version: "1.0.0" });
await client.connect(clientTransport);

interface ToolReply {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolReply;
}

const textOf = (result: ToolReply): string => result.content.map((part) => part.text ?? "").join("\n");

const NAME = "zz-fx12-read-and-etag";

// A notebook with a body long enough that `outline` and `full` cannot be confused: the
// code string appears in `full` and must not appear in `outline`.
const CODE = "const marker = 'FULL_TEXT_ONLY_MARKER'; return { marker };";

await notebooksService.save(
  {
    version: "1.0",
    id: undefined,
    name: NAME,
    runtime: "node",
    steps: [{ id: "cell-1", kind: "cell", note: "The only cell.", code: CODE }],
  } as never,
  "test-agent",
  OWNER
);

const found = await notebooksService.findByIdOrName(NAME);
assert.ok(found && found !== "ambiguous", `fixture ${NAME} was not saved`);
const record = found;

// ── T-04: the default `part` is `outline`, not `full` ─────────────────────────

console.log("\nT-04 — notebook_read default");

await check("omitting `part` returns the outline, not the whole text", async () => {
  const reply = await call("notebook_read", { notebook: NAME });
  const text = textOf(reply);
  assert.ok(
    !text.includes("FULL_TEXT_ONLY_MARKER"),
    "the default reply contained the cell's code, so it is still `full`"
  );
});

await check("`part: full` still returns the whole text", async () => {
  const text = textOf(await call("notebook_read", { notebook: NAME, part: "full" }));
  assert.ok(text.includes("FULL_TEXT_ONLY_MARKER"), "`full` did not contain the cell's code");
});

await check("the default reply carries the `updated_at` a writer needs back", async () => {
  const text = textOf(await call("notebook_read", { notebook: NAME }));
  assert.match(text, /updated_at:/, "no updated_at in the default reply");
});

// ── T-03: a stale `expected_updated_at` is refused ───────────────────────────

console.log("\nT-03 — expected_updated_at");

const currentIso = new Date(record.updated_at).toISOString();
const staleIso = new Date(new Date(record.updated_at).getTime() - 60_000).toISOString();

await check("a matching expected_updated_at lets the edit through", async () => {
  const reply = await call("notebook_edit_cell", {
    notebook: NAME,
    action: "replace",
    cell: "cell-1",
    note: "Edited with the right stamp.",
    expected_updated_at: currentIso,
    dry_run: true,
  });
  assert.ok(!reply.isError, `refused despite a matching stamp: ${textOf(reply)}`);
});

await check("a stale expected_updated_at is refused, and says so", async () => {
  const reply = await call("notebook_edit_cell", {
    notebook: NAME,
    action: "replace",
    cell: "cell-1",
    note: "Edited with a stale stamp.",
    expected_updated_at: staleIso,
  });
  assert.match(textOf(reply), /does not match|refused/i, "a stale stamp was not refused");
});

await check("a stale stamp saves nothing", async () => {
  const after = await notebooksService.findByIdOrName(NAME);
  assert.ok(after && after !== "ambiguous");
  const document = notebooksService.parseDocument(after);
  const first = document.steps[0] as { note?: string };
  assert.notEqual(first.note, "Edited with a stale stamp.", "the refused edit was saved anyway");
});

await check("no expected_updated_at at all still works, for callers that do not send one", async () => {
  const reply = await call("notebook_edit_cell", {
    notebook: NAME,
    action: "replace",
    cell: "cell-1",
    note: "No stamp sent.",
    dry_run: true,
  });
  assert.ok(!reply.isError, `refused with no stamp sent: ${textOf(reply)}`);
});

await check("notebook_edit_setup refuses a stale stamp too", async () => {
  const reply = await call("notebook_edit_setup", {
    notebook: NAME,
    key: "secrets",
    value: JSON.stringify(["CHANGED_BEHIND_THE_OTHER_WRITERS_BACK"]),
    expected_updated_at: staleIso,
  });
  assert.match(textOf(reply), /does not match|refused/i, "edit_setup ignored a stale stamp");
});

await pool.query("DELETE FROM notebooks WHERE name = $1", [NAME]);
await client.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

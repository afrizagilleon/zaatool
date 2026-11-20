/**
 * M6 — the endpoint an agent actually dials.
 *
 * The tool suite proves the handlers; this proves the door: a real HTTP server, a real
 * Streamable HTTP client, real tokens. What it is really checking is that nothing
 * reaches a tool without a valid token, and that both header styles work — Claude Code
 * and Hermes send `Authorization: Bearer`, Perplexity sends `X-API-Key`.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/mcp-http.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/server/app.js";
import { agentTokensService } from "../src/services/agent-tokens.service.js";
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
const OWNER = (await testOwner("mcphttp")).id;

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;
const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);

const authorToken = (await agentTokensService.issue(OWNER, "zz-http-author", "author")).token;
const readerToken = (await agentTokensService.issue(OWNER, "zz-http-reader", "reader")).token;
const revoked = await agentTokensService.issue(OWNER, "zz-http-revoked", "author");
await agentTokensService.revoke(revoked.record.id);

async function connect(headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "zz-http-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } }));
  return client;
}

const opened: Client[] = [];
const created: string[] = [];

console.log("\nthe door");

await check("a bearer token gets in and can see the tools", async () => {
  const client = await connect({ Authorization: `Bearer ${authorToken}` });
  opened.push(client);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(names.includes("notebook_write"), `author tools missing: ${names.join(", ")}`);
});

await check("an X-API-Key gets in too, which is how Perplexity connects", async () => {
  const client = await connect({ "X-API-Key": readerToken });
  opened.push(client);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(names.includes("notebook_list"), "reader cannot list");
  assert.ok(!names.includes("notebook_write"), "reader was handed a write tool over HTTP");
});

await check("no token is refused", async () => {
  await assert.rejects(() => connect({}), /401|Unauthorized|Missing agent token/i);
});

await check("a made-up token is refused", async () => {
  await assert.rejects(
    () => connect({ Authorization: "Bearer zaa_0000000000" }),
    /401|Unauthorized|Unknown or revoked/i
  );
});

await check("a revoked token is refused", async () => {
  await assert.rejects(
    () => connect({ Authorization: `Bearer ${revoked.token}` }),
    /401|Unauthorized|Unknown or revoked/i
  );
});

console.log("\nend to end");

await check("an agent writes a notebook and runs it, over HTTP", async () => {
  const client = await connect({ Authorization: `Bearer ${authorToken}` });
  opened.push(client);

  const written = (await client.callTool({
    name: "notebook_write",
    arguments: {
      text: [
        "---",
        "name: zz-http-roundtrip",
        "runtime: node",
        "outputs: [answer]",
        "---",
        "",
        "Work out the answer.",
        "",
        "```js",
        "return { answer: 6 * 7 };",
        "```",
      ].join("\n"),
    },
  })) as { content: { text: string }[]; isError?: boolean };

  const text = written.content.map((part) => part.text).join("\n");
  assert.ok(!written.isError, text);
  const id = /`([0-9a-f-]{36})`/.exec(text)?.[1];
  assert.ok(id, `no id in reply: ${text}`);
  created.push(id);

  const ran = (await client.callTool({
    name: "notebook_run",
    arguments: { notebook: "zz-http-roundtrip" },
  })) as { content: { text: string }[] };

  const result = JSON.parse(ran.content.map((part) => part.text).join("\n"));
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.deepEqual(result.outputs, { answer: 42 });
});

await check("the notebook it wrote is a normal notebook in the database", async () => {
  const found = await notebooksService.findByIdOrName("zz-http-roundtrip");
  assert.ok(found && found !== "ambiguous", "the agent's notebook is not in the store");
  const document = notebooksService.parseDocument(found);
  assert.deepEqual(document.outputs, ["answer"]);
});

for (const client of opened) await client.close().catch(() => {});
for (const id of created) await notebooksService.delete(id).catch(() => {});
await pool.query("DELETE FROM agent_tokens WHERE label LIKE 'zz-http-%'");
await dropOwner("mcphttp");
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

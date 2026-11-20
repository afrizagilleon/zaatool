import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { agentTokensService } from "../src/services/agent-tokens.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { testOwner, dropOwner } from "./owners.js";

/**
 * K-27. /mcp is parsed before the router authenticates, and it used the small limit for
 * everybody, so an agent writing a large notebook was refused with 413 before its token was
 * even looked at. A live agent token now gets the notebook limit; anyone else keeps the small
 * one. The body here is ~2 MB: over the 1 MB default, under the 50 MB notebook default.
 */
process.env.MAX_JSON_BODY_MB = "1";
delete process.env.MAX_NOTEBOOK_JSON_MB;

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
await dropOwner("mcpbody");
const owner = (await testOwner("mcpbody")).id;
const live = (await agentTokensService.issue(owner, "zz-mcpbody-live", "author")).token;
const revoked = await agentTokensService.issue(owner, "zz-mcpbody-revoked", "author");
await agentTokensService.revoke(revoked.record.id, owner);

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;

const big = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: { padding: "x".repeat(2 * 1024 * 1024) },
});

async function post(headers: Record<string, string>): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: big,
  });
  await res.arrayBuffer();
  return res.status;
}

console.log("\nmcp-body-limit (K-27: a live agent token gets the notebook body limit)");

try {
  await check("a live agent token can send a body over the small limit", async () => {
    assert.notEqual(await post({ authorization: `Bearer ${live}` }), 413);
  });
  await check("the same body without a token is refused as too large", async () => {
    assert.equal(await post({}), 413);
  });
  await check("a revoked token does not get the larger limit", async () => {
    assert.equal(await post({ authorization: `Bearer ${revoked.token}` }), 413);
  });
  await check("a made-up token does not get the larger limit", async () => {
    assert.equal(await post({ "x-api-key": "zaa_not-a-real-token" }), 413);
  });
} finally {
  server.close();
  await dropOwner("mcpbody");
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

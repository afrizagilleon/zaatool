/**
 * JSON body limits. The default is small because /hooks, /api/shared and /mcp are parsed
 * before anyone has proved who they are; only /api/notebooks (behind a session) keeps a
 * larger one. Test data is prefixed `zz-k10-` and removed.
 *
 *   pnpm --filter @zaa-tool/engine test body-limits
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { authService } from "../src/services/auth.service.js";
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
const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

await pool.query("DELETE FROM users WHERE username = 'zz-k10-user'").catch(() => {});
await authService.createUser("zz-k10-user", "zz-k10-password", "creator");
const token = (await authService.login("zz-k10-user", "zz-k10-password")).token;
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const TWO_MB = JSON.stringify({ args: { blob: "x".repeat(2 * 1024 * 1024) } });

console.log("\nbody limits");

await check("a >1 MB JSON body to /hooks/<slug> is refused with 413, no auth involved", async () => {
  const res = await fetch(`${base}/hooks/zz-k10-no-such-slug`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: TWO_MB,
  });
  assert.equal(res.status, 413);
});

await check("a >1 MB JSON body to /api/shared/<token>/run is refused with 413", async () => {
  const res = await fetch(`${base}/api/shared/zz-k10-no-such-token/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: TWO_MB,
  });
  assert.equal(res.status, 413);
});

await check("a >1 MB JSON body to /mcp is refused with 413 before the token is looked at", async () => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: TWO_MB,
  });
  assert.equal(res.status, 413);
});

await check("a small body still reaches the route (unknown slug is a 404, not a 413)", async () => {
  const res = await fetch(`${base}/hooks/zz-k10-no-such-slug`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.status, 404);
});

await check("a creator can still save a >1 MB notebook through /api/notebooks/text", async () => {
  const text = [
    "---",
    "name: zz-k10-big",
    "id: zz-k10-big-id",
    "runtime: node",
    "---",
    "",
    "```js",
    "// " + "x".repeat(2 * 1024 * 1024),
    "return {};",
    "```",
  ].join("\n");
  const res = await fetch(`${base}/api/notebooks/text`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text }),
  });
  assert.equal(res.status, 200, (await res.text()).slice(0, 200));
});

await check("an ordinary /api route (not notebooks) gets the small limit", async () => {
  const res = await fetch(`${base}/api/agent-tokens`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ label: "x".repeat(2 * 1024 * 1024) }),
  });
  assert.equal(res.status, 413);
});

await notebooksService.delete("zz-k10-big-id").catch(() => {});
await pool.query("DELETE FROM users WHERE username = 'zz-k10-user'").catch(() => {});
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

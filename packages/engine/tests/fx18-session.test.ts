/**
 * FX-18 — a session is a cookie, and a session can be ended.
 *
 * Written as attempts, like `access.test.ts`: what matters is that the request is refused
 * or accepted, not which layer did it.
 *
 *   pnpm --filter @zaa-tool/engine test fx18-session
 */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { authService } from "../src/services/auth.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";

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

const PASSWORD = "zz-fx18-password-1";
const USERS = ["zz-fx18-revoke", "zz-fx18-all", "zz-fx18-pw", "zz-fx18-off", "zz-fx18-cli"];

async function clean(): Promise<void> {
  await pool.query("DELETE FROM users WHERE username LIKE 'zz-fx18-%'");
  fs.rmSync(path.join(STORAGE_DIR, "zz-fx18"), { recursive: true, force: true });
}

await clean();
fs.mkdirSync(path.join(STORAGE_DIR, "zz-fx18"), { recursive: true });
fs.writeFileSync(path.join(STORAGE_DIR, "zz-fx18", "a.txt"), "hello");

async function newUser(username: string, role: "creator" | "viewer" = "creator") {
  const created = await authService.createUser(username, PASSWORD, role);
  const { token } = await authService.login(username, PASSWORD);
  return { id: created.id, token };
}

const get = (url: string, headers: Record<string, string> = {}) => fetch(`${base}${url}`, { headers });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log("\nrevocation (token_version)");

await check("a token carries tv, and a fresh login works on /api and /storage", async () => {
  const { token } = await newUser(USERS[0]);
  const decoded = authService.verifyToken(token);
  assert.equal(decoded?.tv, 0);
  assert.equal((await get("/api/auth/me", bearer(token))).status, 200);
  assert.equal((await get("/storage/zz-fx18/a.txt", bearer(token))).status, 200);
});

await check("logout-all ends the token that asked and every other, then a new login works", async () => {
  const { token } = await newUser(USERS[1]);
  const other = (await authService.login(USERS[1], PASSWORD)).token;
  const res = await fetch(`${base}/api/auth/logout-all`, { method: "POST", headers: bearer(token) });
  assert.equal(res.status, 200);
  for (const t of [token, other]) {
    assert.equal((await get("/api/auth/me", bearer(t))).status, 401, "old token on /api");
    assert.equal((await get("/storage/zz-fx18/a.txt", bearer(t))).status, 401, "old token on /storage");
  }
  const fresh = (await authService.login(USERS[1], PASSWORD)).token;
  assert.equal((await get("/api/auth/me", bearer(fresh))).status, 200);
});

await check("changing the password ends old tokens; the one handed back works", async () => {
  const { token } = await newUser(USERS[2]);
  const res = await fetch(`${base}/api/auth/me/password`, {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "zz-fx18-password-2" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { token: string };
  assert.equal((await get("/api/auth/me", bearer(token))).status, 401);
  assert.equal((await get("/storage/zz-fx18/a.txt", bearer(token))).status, 401);
  assert.equal((await get("/api/auth/me", bearer(body.token))).status, 200);
});

await check("deactivating refuses the token, and reactivating does not bring it back", async () => {
  const { id, token } = await newUser(USERS[3]);
  await authService.setActive(id, false);
  assert.equal((await get("/api/auth/me", bearer(token))).status, 403, "deactivated: 403 as before");
  assert.equal((await get("/storage/zz-fx18/a.txt", bearer(token))).status, 401, "storage bearer, inactive");
  await authService.setActive(id, true);
  assert.equal((await get("/api/auth/me", bearer(token))).status, 401, "old token stays dead after reactivation");
  assert.equal((await get("/storage/zz-fx18/a.txt", bearer(token))).status, 401);
  const fresh = (await authService.login(USERS[3], PASSWORD)).token;
  assert.equal((await get("/api/auth/me", bearer(fresh))).status, 200);
});

await check("the reset-password script ends old tokens", async () => {
  const { token } = await newUser(USERS[4]);
  const run = spawnSync(
    "node",
    ["--import", "tsx", "scripts/reset-password.ts", USERS[4], "--password", "zz-fx18-password-3"],
    { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", env: process.env }
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal((await get("/api/auth/me", bearer(token))).status, 401);
  const fresh = (await authService.login(USERS[4], "zz-fx18-password-3")).token;
  assert.equal((await get("/api/auth/me", bearer(fresh))).status, 200);
});

// ── end ───────────────────────────────────────────────────────────────────────

await clean();
server.close();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

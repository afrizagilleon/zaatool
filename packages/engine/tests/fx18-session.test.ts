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
const USERS = ["zz-fx18-revoke", "zz-fx18-all", "zz-fx18-pw", "zz-fx18-off", "zz-fx18-cli", "zz-fx18-cookie"];

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

console.log("\nthe cookie");

/** The `zaa_session` Set-Cookie line of a response, or null. */
function sessionSetCookie(res: Response): string | null {
  return res.headers.getSetCookie().find((line) => line.startsWith("zaa_session=")) ?? null;
}

async function loginRaw(username: string, password = PASSWORD): Promise<Response> {
  return fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

await check("login sets zaa_session: HttpOnly, SameSite=Lax, Path=/, a day long, token still in the body", async () => {
  delete process.env.COOKIE_SECURE;
  delete process.env.NODE_ENV;
  await authService.createUser(USERS[5], PASSWORD, "creator");
  const res = await loginRaw(USERS[5]);
  assert.equal(res.status, 200);
  const line = sessionSetCookie(res);
  assert.ok(line, "no zaa_session cookie");
  assert.match(line, /; HttpOnly/i);
  assert.match(line, /; SameSite=Lax/i);
  assert.match(line, /; Path=\//);
  assert.match(line, /; Max-Age=86400/i);
  assert.doesNotMatch(line, /; Secure/i, "Secure outside production");
  const body = (await res.json()) as { token: string };
  assert.ok(body.token, "body token kept for curl");
  assert.equal(line.split(";")[0], `zaa_session=${body.token}`);
});

await check("Secure follows NODE_ENV=production, and COOKIE_SECURE overrides it either way", async () => {
  try {
    process.env.NODE_ENV = "production";
    delete process.env.COOKIE_SECURE;
    assert.match(sessionSetCookie(await loginRaw(USERS[5])) ?? "", /; Secure/i, "production default");

    process.env.COOKIE_SECURE = "false";
    assert.doesNotMatch(sessionSetCookie(await loginRaw(USERS[5])) ?? "", /; Secure/i, "COOKIE_SECURE=false");

    delete process.env.NODE_ENV;
    process.env.COOKIE_SECURE = "true";
    assert.match(sessionSetCookie(await loginRaw(USERS[5])) ?? "", /; Secure/i, "COOKIE_SECURE=true");
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.COOKIE_SECURE;
  }
});

await check("a request with only the cookie is signed in; a Bearer header wins when both are sent", async () => {
  const login = await loginRaw(USERS[5]);
  const cookie = (sessionSetCookie(login) ?? "").split(";")[0];
  const me = await get("/api/auth/me", { Cookie: cookie });
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { user: { username: string } }).user.username, USERS[5]);

  const garbage = await get("/api/auth/me", { Cookie: "zaa_session=not-a-token" });
  assert.equal(garbage.status, 401);

  const both = await get("/api/auth/me", { Cookie: cookie, Authorization: "Bearer not-a-token" });
  assert.equal(both.status, 401, "the bad Bearer was used, not the good cookie");
});

await check("logout clears the cookie with the same attributes, and leaves other sessions alone", async () => {
  const first = await loginRaw(USERS[5]);
  const cookie = (sessionSetCookie(first) ?? "").split(";")[0];
  const other = ((await (await loginRaw(USERS[5])).json()) as { token: string }).token;

  const out = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(out.status, 200);
  const line = sessionSetCookie(out);
  assert.ok(line);
  assert.match(line, /^zaa_session=;/);
  assert.match(line, /Expires=Thu, 01 Jan 1970/i);
  assert.match(line, /; Path=\//);
  assert.match(line, /; HttpOnly/i);

  assert.equal((await get("/api/auth/me", bearer(other))).status, 200, "another session survives logout");
});

await check("logout-all and a password change clear/replace the cookie in the response", async () => {
  const cookie = (sessionSetCookie(await loginRaw(USERS[5])) ?? "").split(";")[0];
  const changed = await fetch(`${base}/api/auth/me/password`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "zz-fx18-password-4" }),
  });
  assert.equal(changed.status, 200);
  const renewed = (sessionSetCookie(changed) ?? "").split(";")[0];
  assert.ok(renewed && renewed !== cookie, "cookie was not replaced");
  assert.equal((await get("/api/auth/me", { Cookie: cookie })).status, 401, "old cookie dead");
  assert.equal((await get("/api/auth/me", { Cookie: renewed })).status, 200, "new cookie works");

  const all = await fetch(`${base}/api/auth/logout-all`, { method: "POST", headers: { Cookie: renewed } });
  assert.equal(all.status, 200);
  assert.match(sessionSetCookie(all) ?? "", /^zaa_session=;/);
  assert.equal((await get("/api/auth/me", { Cookie: renewed })).status, 401);
});

// ── end ───────────────────────────────────────────────────────────────────────

await clean();
server.close();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

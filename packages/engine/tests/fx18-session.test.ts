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
import { notebookSharesService } from "../src/services/notebook-shares.service.js";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { WebSocketManager } from "../src/server/websocket-manager.js";
import WebSocket from "ws";
import type { RunEvent } from "@zaa-tool/shared";

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

// This file signs in a dozen times; the login limiter is tested elsewhere.
process.env.LOGIN_RATE_LIMIT_MAX = "1000";

await initDb();

const server = http.createServer(createApp(() => {}));
const hub = new RunEventHub();
const sockets = new WebSocketManager(server, hub);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const PASSWORD = "zz-fx18-password-1";
const USERS = ["zz-fx18-revoke", "zz-fx18-all", "zz-fx18-pw", "zz-fx18-off", "zz-fx18-cli", "zz-fx18-cookie", "zz-fx18-csrf", "zz-fx18-ws"];

async function clean(): Promise<void> {
  await pool.query("DELETE FROM notebook_runs WHERE id IN ('zz-fx18', 'zz-fx18-run')");
  await pool.query("DELETE FROM notebook_shares WHERE notebook_id = 'zz-fx18-nb'");
  await pool.query("DELETE FROM notebooks WHERE id = 'zz-fx18-nb'");
  await pool.query("DELETE FROM users WHERE username LIKE 'zz-fx18-%'");
  await pool.query("DELETE FROM notebook_shares WHERE created_by = 'zz-fx18'");
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

/** What a page sends with anything that changes data; see `csrf.middleware.ts`. */
const XHR = { "X-Zaatool-Request": "1" };

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
    headers: { "Content-Type": "application/json", ...XHR },
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

  const out = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, ...XHR } });
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
    headers: { Cookie: cookie, "Content-Type": "application/json", ...XHR },
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "zz-fx18-password-4" }),
  });
  assert.equal(changed.status, 200);
  const renewed = (sessionSetCookie(changed) ?? "").split(";")[0];
  assert.ok(renewed && renewed !== cookie, "cookie was not replaced");
  assert.equal((await get("/api/auth/me", { Cookie: cookie })).status, 401, "old cookie dead");
  assert.equal((await get("/api/auth/me", { Cookie: renewed })).status, 200, "new cookie works");

  const all = await fetch(`${base}/api/auth/logout-all`, { method: "POST", headers: { Cookie: renewed, ...XHR } });
  assert.equal(all.status, 200);
  assert.match(sessionSetCookie(all) ?? "", /^zaa_session=;/);
  assert.equal((await get("/api/auth/me", { Cookie: renewed })).status, 401);
});

console.log("\nCSRF (X-Zaatool-Request)");

const invite = (headers: Record<string, string>, name: string) =>
  fetch(`${base}/api/auth/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ username: name, password: PASSWORD, role: "viewer" }),
  });

await check("cookie-authenticated writes need the header; reads, and writes carrying it, do not", async () => {
  await authService.createUser(USERS[6], PASSWORD, "creator");
  const cookie = (sessionSetCookie(await loginRaw(USERS[6])) ?? "").split(";")[0];

  assert.equal((await get("/api/auth/me", { Cookie: cookie })).status, 200, "GET without header");

  const refused = await invite({ Cookie: cookie }, "zz-fx18-forged");
  assert.equal(refused.status, 403);
  const { rows } = await pool.query("SELECT 1 FROM users WHERE username = 'zz-fx18-forged'");
  assert.equal(rows.length, 0, "the forged write went through anyway");

  const wrongValue = await invite({ Cookie: cookie, "X-Zaatool-Request": "0" }, "zz-fx18-forged");
  assert.equal(wrongValue.status, 403, "only the value 1 counts");

  assert.equal((await invite({ Cookie: cookie, ...XHR }, "zz-fx18-invited1")).status, 201);

  for (const method of ["PATCH", "DELETE", "PUT"]) {
    const res = await fetch(`${base}/api/auth/users/anything`, { method, headers: { Cookie: cookie } });
    assert.equal(res.status, 403, `${method} without header`);
  }

  const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(logout.status, 403, "a forged logout is refused too");
  assert.equal((await get("/api/auth/me", { Cookie: cookie })).status, 200, "and the session survived it");
});

await check("Bearer callers do not need the header, and neither does a request that names no one", async () => {
  const { token } = await authService.login(USERS[6], PASSWORD);
  assert.equal((await invite(bearer(token), "zz-fx18-invited2")).status, 201);

  const cookie = (sessionSetCookie(await loginRaw(USERS[6])) ?? "").split(";")[0];
  assert.equal((await invite({ ...bearer(token), Cookie: cookie }, "zz-fx18-invited3")).status, 201, "Bearer wins over cookie");

  assert.equal((await invite({}, "zz-fx18-invited4")).status, 401, "no credential: 401, not 403");
});

await check("login and register need the header whoever asks", async () => {
  const bare = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERS[6], password: PASSWORD }),
  });
  assert.equal(bare.status, 403);
  assert.equal(sessionSetCookie(bare), null, "a cookie was set for a forged login");

  const register = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "zz-fx18-regforged", password: PASSWORD }),
  });
  assert.equal(register.status, 403);
  const { rows } = await pool.query("SELECT 1 FROM users WHERE username = 'zz-fx18-regforged'");
  assert.equal(rows.length, 0);

  assert.equal((await loginRaw(USERS[6])).status, 200, "with the header it works");
});

await check("a multipart upload with the cookie and the header gets through the guard", async () => {
  const cookie = (sessionSetCookie(await loginRaw(USERS[6])) ?? "").split(";")[0];
  const form = new FormData();
  form.append("file", new Blob(["x"]), "zz-fx18-up.txt");

  const refused = await fetch(`${base}/api/resources/files`, { method: "POST", headers: { Cookie: cookie }, body: form });
  assert.equal(refused.status, 403, "multipart without header");

  const sent = await fetch(`${base}/api/resources/files`, {
    method: "POST",
    headers: { Cookie: cookie, ...XHR },
    body: form,
  });
  assert.notEqual(sent.status, 403);
  assert.notEqual(sent.status, 401);
  fs.rmSync(path.join(STORAGE_DIR, "zz-fx18-up.txt"), { force: true });
});

console.log("\nWebSocket (Origin and cookie)");

type Opened =
  | { ok: true; socket: WebSocket; messages: Record<string, unknown>[] }
  | { ok: false; status: number };

/** Opens `/ws` with the given headers, or reports the status the upgrade was refused with. */
function connect(headers: Record<string, string>): Promise<Opened> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    const messages: Record<string, unknown>[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    socket.on("open", () => resolve({ ok: true, socket, messages }));
    socket.on("unexpected-response", (_req, res) => {
      resolve({ ok: false, status: res.statusCode ?? 0 });
      res.resume();
    });
    socket.on("error", () => undefined);
  });
}

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const origin = `http://127.0.0.1:${port}`;

/**
 * The socket only delivers runs, and lets a link follow runs, that exist and that the caller
 * may see (FX-17), so the events below are about real rows: a notebook the socket's user
 * owns, and two runs of it that nobody started — the owner's to read.
 */
async function ownedRows(ownerId: string): Promise<void> {
  await pool.query("DELETE FROM notebook_runs WHERE id IN ('zz-fx18', 'zz-fx18-run')");
  await pool.query("DELETE FROM notebook_shares WHERE notebook_id = 'zz-fx18-nb'");
  await pool.query("DELETE FROM notebooks WHERE id = 'zz-fx18-nb'");
  await pool.query(
    "INSERT INTO notebooks (id, name, runtime, document, owner_id) VALUES ('zz-fx18-nb', 'zz-fx18-nb', 'node', '{}', $1)",
    [ownerId]
  );
  for (const id of ["zz-fx18", "zz-fx18-run"]) {
    await pool.query(
      "INSERT INTO notebook_runs (id, notebook_id, status, trigger_source) VALUES ($1, 'zz-fx18-nb', 'running', 'cron')",
      [id]
    );
  }
}

async function wsSession(): Promise<string> {
  await pool.query("DELETE FROM users WHERE username = $1", [USERS[7]]);
  await ownedRows((await authService.createUser(USERS[7], PASSWORD, "creator")).id);
  return (sessionSetCookie(await loginRaw(USERS[7])) ?? "").split(";")[0];
}

/** Watches with whatever identity the socket arrived with; true if a run's activity reached it. */
async function hearsActivity(opened: Opened): Promise<{ heard: boolean; messages: Record<string, unknown>[] }> {
  assert.ok(opened.ok, "the socket was refused");
  opened.socket.send(JSON.stringify({ action: "watch" }));
  await settle();
  hub.publish({ type: "cell:start", runId: "zz-fx18", notebookId: "zz-fx18-nb", cellId: "c1" } as RunEvent);
  await settle();
  opened.socket.close();
  return { heard: opened.messages.some((m) => m.type === "run:activity"), messages: opened.messages };
}

await check("a foreign Origin is refused at the upgrade, cookie or not", async () => {
  const cookie = await wsSession();
  assert.deepEqual(await connect({ Origin: "https://evil.example", Cookie: cookie }), { ok: false, status: 403 });
  assert.deepEqual(await connect({ Origin: "https://evil.example" }), { ok: false, status: 403 });
  assert.deepEqual(await connect({ Origin: "null", Cookie: cookie }), { ok: false, status: 403 });
});

await check("the same origin is accepted, and the cookie alone is a session (no auth message)", async () => {
  const cookie = await wsSession();
  const result = await hearsActivity(await connect({ Origin: origin, Cookie: cookie }));
  assert.equal(result.heard, true, JSON.stringify(result.messages));
});

await check("no Origin (a script) is accepted; a Bearer token still works through the auth message", async () => {
  await wsSession();
  const { token } = await authService.login(USERS[7], PASSWORD);
  const opened = await connect({});
  assert.ok(opened.ok);
  opened.socket.send(JSON.stringify({ action: "auth", token }));
  const result = await hearsActivity(opened);
  assert.equal(result.heard, true);
});

await check("a cookie that has been ended is not a session", async () => {
  const cookie = await wsSession();
  await fetch(`${base}/api/auth/logout-all`, { method: "POST", headers: { Cookie: cookie, ...XHR } });
  const result = await hearsActivity(await connect({ Origin: origin, Cookie: cookie }));
  assert.equal(result.heard, false);
  assert.ok(result.messages.some((m) => m.type === "run:denied"), "expected a refusal");
});

await check("the dev origin passes outside production, and only while CORS_ORIGINS is unset", async () => {
  const cookie = await wsSession();
  try {
    delete process.env.NODE_ENV;
    delete process.env.CORS_ORIGINS;
    const dev = await connect({ Origin: "http://localhost:5173", Cookie: cookie });
    assert.ok(dev.ok, "dev origin refused outside production");
    if (dev.ok) dev.socket.close();

    process.env.CORS_ORIGINS = "https://app.example.com";
    assert.deepEqual(await connect({ Origin: "http://localhost:5173", Cookie: cookie }), { ok: false, status: 403 });
    const declared = await connect({ Origin: "https://app.example.com", Cookie: cookie });
    assert.ok(declared.ok, "an origin named in CORS_ORIGINS was refused");
    if (declared.ok) declared.socket.close();

    delete process.env.CORS_ORIGINS;
    process.env.NODE_ENV = "production";
    assert.deepEqual(await connect({ Origin: "http://localhost:5173", Cookie: cookie }), { ok: false, status: 403 });
    const same = await connect({ Origin: origin, Cookie: cookie });
    assert.ok(same.ok, "same origin refused in production");
    if (same.ok) same.socket.close();
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.CORS_ORIGINS;
  }
});

await check("behind a rewriting proxy the original host comes from X-Forwarded-Host", async () => {
  const cookie = await wsSession();
  const proxied = await connect({ Origin: "https://zaa.example.com", "X-Forwarded-Host": "zaa.example.com", Cookie: cookie });
  assert.ok(proxied.ok);
  if (proxied.ok) proxied.socket.close();
  const lying = await connect({ Origin: "https://evil.example", "X-Forwarded-Host": "zaa.example.com", Cookie: cookie });
  assert.deepEqual(lying, { ok: false, status: 403 });
});

await check("a share token still opens a stream: it can follow a run but not watch the workspace", async () => {
  await wsSession();
  const share = await notebookSharesService.create("zz-fx18-nb", "zz-fx18");
  const opened = await connect({ Origin: origin });
  assert.ok(opened.ok);
  opened.socket.send(JSON.stringify({ action: "auth", token: share.token }));
  opened.socket.send(JSON.stringify({ action: "subscribe", runId: "zz-fx18-run" }));
  await settle();
  hub.publish({ type: "cell:start", runId: "zz-fx18-run", notebookId: "zz-fx18-nb", cellId: "c1" } as RunEvent);
  await settle();
  assert.ok(opened.messages.some((m) => m.runId === "zz-fx18-run"), JSON.stringify(opened.messages));

  opened.socket.send(JSON.stringify({ action: "watch" }));
  await settle();
  assert.ok(opened.messages.some((m) => m.type === "run:denied"), "a share token must not watch");
  opened.socket.close();
});

// ── end ───────────────────────────────────────────────────────────────────────

await clean();
sockets.close();
server.close();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

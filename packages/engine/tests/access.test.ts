/**
 * M18 — the front door.
 *
 * Four things were true of this engine until now, and each of them is a line in this file:
 *
 *   1. `users.role` was written into every token and read by nothing.
 *   2. Anyone who could reach the port could make an account.
 *   3. `?dir=../../..` was handed to `path.join` unexamined.
 *   4. `/storage` was `express.static` with nothing in front of it.
 *
 * The tests are written as attempts rather than as assertions about implementation: what
 * matters is that the request is refused, not which layer refuses it.
 *
 *   pnpm --filter @zaa-tool/engine test access
 */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { authService } from "../src/services/auth.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { safeFilename, safeSubPath, resolveInside } from "../src/core/storage-paths.js";
import { signStorageLink, storageLinkValid } from "../src/core/storage-links.js";
import { configProblems } from "../src/config.js";
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

// ── two accounts, one of each kind ────────────────────────────────────────────

const CREATOR = "zz-access-creator";
const VIEWER = "zz-access-viewer";
const PASSWORD = "zz-access-password";

for (const [username, role] of [[CREATOR, "creator"], [VIEWER, "viewer"]] as const) {
  await pool.query("DELETE FROM users WHERE username = $1", [username]);
  await authService.createUser(username, PASSWORD, role);
}

const creatorToken = (await authService.login(CREATOR, PASSWORD)).token;
const viewerToken = (await authService.login(VIEWER, PASSWORD)).token;
const asCreator = { Authorization: `Bearer ${creatorToken}` };
const asViewer = { Authorization: `Bearer ${viewerToken}` };

// ── paths ─────────────────────────────────────────────────────────────────────

console.log("\nwhere a path is allowed to go");

check("a walk upwards is refused rather than clamped", () => {
  for (const attempt of ["../../..", "a/../../b", "..", "../secrets"]) {
    assert.equal(safeSubPath(attempt, STORAGE_DIR), null, `"${attempt}" was accepted`);
  }
});

check("an absolute path is refused, including a Windows one", () => {
  assert.equal(safeSubPath("/etc/passwd", STORAGE_DIR), "etc/passwd");
  assert.equal(safeSubPath("C:\\Windows\\System32", STORAGE_DIR), null);
});

check("an ordinary folder still resolves", () => {
  assert.equal(safeSubPath("images/2026", STORAGE_DIR), "images/2026");
  assert.equal(safeSubPath("", STORAGE_DIR), "");
  assert.equal(resolveInside("images", STORAGE_DIR), path.resolve(STORAGE_DIR, "images"));
});

check("a filename is one segment, never a route", () => {
  assert.equal(safeFilename("../../server.js"), "server.js");
  assert.equal(safeFilename("a/b/c.png"), "c.png");
  assert.equal(safeFilename("..\\..\\evil.exe"), "evil.exe");
});

check("a name that would vanish or hide gets a dull one instead", () => {
  assert.equal(safeFilename(".env"), "env");
  assert.equal(safeFilename("report."), "report");
  assert.equal(safeFilename("..."), "file");
  assert.equal(safeFilename(""), "file");
  // Windows refuses these outright, so a file written on Linux would be unopenable there.
  assert.equal(safeFilename("con.txt"), "_con.txt");
});

// ── signed links ──────────────────────────────────────────────────────────────

console.log("\na link that carries its own permission");

check("a signature covers one path and only that path", () => {
  const link = signStorageLink("images/chart.png");
  const url = new URL(link, "http://localhost");
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");

  assert.equal(storageLinkValid("images/chart.png", exp, sig), true);
  // The same proof, pointed at a different file.
  assert.equal(storageLinkValid("images/private.png", exp, sig), false);
});

check("an expired link stops working, and a tampered expiry does not extend it", () => {
  const link = signStorageLink("a.png", -1000);
  const url = new URL(link, "http://localhost");
  assert.equal(
    storageLinkValid("a.png", url.searchParams.get("exp"), url.searchParams.get("sig")),
    false
  );

  const fresh = new URL(signStorageLink("a.png"), "http://localhost");
  const later = Number(fresh.searchParams.get("exp")) + 86_400_000;
  assert.equal(storageLinkValid("a.png", later, fresh.searchParams.get("sig")), false);
});

// ── what a viewer may do ──────────────────────────────────────────────────────

console.log("\nthe role that is finally read");

async function as(headers: Record<string, string>, method: string, url: string, body?: unknown) {
  return fetch(`${base}${url}`, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

await check("a viewer cannot write a notebook", async () => {
  const res = await as(asViewer, "POST", "/api/notebooks", {
    name: "zz-access-attempt",
    runtime: "node",
    steps: [],
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /creator/);
});

await check("a viewer cannot see the names of the secrets", async () => {
  assert.equal((await as(asViewer, "GET", "/api/resources/secrets")).status, 403);
  assert.equal((await as(asCreator, "GET", "/api/resources/secrets")).status, 200);
});

await check("a viewer can still open the pages and read the map", async () => {
  assert.equal((await as(asViewer, "GET", "/api/notebooks/pages")).status, 200);
  assert.equal((await as(asViewer, "GET", "/api/notebooks/map")).status, 200);
  assert.equal((await as(asViewer, "GET", "/api/notebooks")).status, 200);
});

await check("a token with no role in it is treated as the weakest one", async () => {
  const decoded = authService.verifyToken(viewerToken);
  assert.equal(decoded?.role, "viewer");
});

// ── registration ──────────────────────────────────────────────────────────────

console.log("\nthe door, after the first person is through");

await check("signing up is refused while ALLOW_REGISTRATION is off", async () => {
  delete process.env.ALLOW_REGISTRATION;
  const res = await as({ "X-Zaatool-Request": "1" }, "POST", "/api/auth/register", {
    username: "zz-access-uninvited",
    password: "zz-access-password",
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /closed/i);

  const { rows } = await pool.query("SELECT id FROM users WHERE username = $1", [
    "zz-access-uninvited",
  ]);
  assert.equal(rows.length, 0, "the account was created anyway");
});

await check("the login screen is told, so it can stop offering the form", async () => {
  delete process.env.ALLOW_REGISTRATION;
  const res = await as({}, "GET", "/api/auth/policy");
  const body = (await res.json()) as { registrationOpen: boolean; firstUser: boolean };
  assert.equal(res.status, 200);
  assert.equal(body.registrationOpen, false);
  assert.equal(body.firstUser, false);
});

await check("a creator can invite, a viewer cannot", async () => {
  await pool.query("DELETE FROM users WHERE username = $1", ["zz-access-invited"]);

  const refused = await as(asViewer, "POST", "/api/auth/users", {
    username: "zz-access-invited",
    password: "zz-access-password",
    role: "viewer",
  });
  assert.equal(refused.status, 403);

  const allowed = await as(asCreator, "POST", "/api/auth/users", {
    username: "zz-access-invited",
    password: "zz-access-password",
    role: "viewer",
  });
  assert.equal(allowed.status, 201);

  await pool.query("DELETE FROM users WHERE username = $1", ["zz-access-invited"]);
});

// ── uploads ───────────────────────────────────────────────────────────────────

console.log("\nan upload no longer chooses where it lands");

await check("a dir that climbs out is refused, and nothing is written", async () => {
  const form = new FormData();
  form.append("file", new Blob(["planted"]), "planted.txt");

  const res = await fetch(`${base}/api/resources/files?dir=${encodeURIComponent("../../..")}`, {
    method: "POST",
    headers: asCreator,
    body: form,
  });
  assert.equal(res.status, 400);

  const escaped = path.resolve(STORAGE_DIR, "../../../planted.txt");
  assert.equal(fs.existsSync(escaped), false, `a file was written to ${escaped}`);
});

await check("a filename that climbs out lands in the folder, under a plain name", async () => {
  const form = new FormData();
  form.append("file", new Blob(["harmless"]), "../../zz-access-escape.txt");

  const res = await fetch(`${base}/api/resources/files`, {
    method: "POST",
    headers: asCreator,
    body: form,
  });
  const body = (await res.json()) as { path?: string };
  assert.equal(res.status, 200);
  assert.equal(body.path, "zz-access-escape.txt");
  assert.equal(fs.existsSync(path.resolve(STORAGE_DIR, "zz-access-escape.txt")), true);
  assert.equal(fs.existsSync(path.resolve(STORAGE_DIR, "../../zz-access-escape.txt")), false);
});

await check("a viewer cannot upload at all", async () => {
  const form = new FormData();
  form.append("file", new Blob(["nope"]), "zz-access-viewer.txt");
  const res = await fetch(`${base}/api/resources/files`, {
    method: "POST",
    headers: asViewer,
    body: form,
  });
  assert.equal(res.status, 403);
});

// ── /storage ──────────────────────────────────────────────────────────────────

console.log("\nthe folder that used to be public");

await check("a bare path is not served to a stranger", async () => {
  const res = await fetch(`${base}/storage/zz-access-escape.txt`);
  assert.equal(res.status, 401);
});

await check("the link the listing hands out works, without any session", async () => {
  const listing = await fetch(`${base}/api/resources/files`, { headers: asCreator });
  const items = (await listing.json()) as { name: string; url?: string }[];
  const uploaded = items.find((item) => item.name === "zz-access-escape.txt");
  assert.ok(uploaded?.url, "the listing did not carry a signed link");

  const res = await fetch(`${base}${uploaded.url}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "harmless");
});

await check("a session can still fetch one with a header", async () => {
  const res = await fetch(`${base}/storage/zz-access-escape.txt`, { headers: asViewer });
  assert.equal(res.status, 200);
});

await check("a signature for one file does not open another", async () => {
  const other = path.resolve(STORAGE_DIR, "zz-access-secret.txt");
  fs.writeFileSync(other, "not for you");

  const link = new URL(signStorageLink("zz-access-escape.txt"), base);
  const res = await fetch(
    `${base}/storage/zz-access-secret.txt?${link.searchParams.toString()}`
  );
  assert.equal(res.status, 401);
});

await check("a climb out of /storage is a 404, not a file", async () => {
  const res = await fetch(`${base}/storage/..%2F..%2Fpackage.json`, { headers: asCreator });
  assert.notEqual(res.status, 200);
});

// ── refusing to start ─────────────────────────────────────────────────────────

console.log("\nwhat production will not start without");

check("a secret that lives in the repository is not a secret in production", () => {
  const previousEnv = process.env.NODE_ENV;
  const previousSecret = process.env.JWT_SECRET;
  const previousKey = process.env.SECRETS_KEY;

  // The key is checked in production too (FX-19); with a valid one it is not what fails here.
  process.env.SECRETS_KEY = "ab".repeat(32);
  process.env.NODE_ENV = "production";
  delete process.env.JWT_SECRET;
  assert.match(configProblems().join(" "), /JWT_SECRET is not set/);

  process.env.JWT_SECRET = "short";
  assert.match(configProblems().join(" "), /minimum/);

  process.env.JWT_SECRET = "x".repeat(48);
  assert.deepEqual(configProblems(), []);

  process.env.NODE_ENV = previousEnv;
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  if (previousKey === undefined) delete process.env.SECRETS_KEY;
  else process.env.SECRETS_KEY = previousKey;
});

// ── clearing up ───────────────────────────────────────────────────────────────

for (const leftover of ["zz-access-escape.txt", "zz-access-secret.txt"]) {
  fs.rmSync(path.resolve(STORAGE_DIR, leftover), { force: true });
}
await pool.query("DELETE FROM users WHERE username = ANY($1)", [[CREATOR, VIEWER]]);
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

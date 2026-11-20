/**
 * FX-16 — the first account needs a code only the server's owner can read.
 *
 * "No users yet" is simulated by replacing `userCount` for the length of this file, not by
 * emptying the table: this database may belong to someone, and deleting their accounts to
 * prove a point is not a test. The accounts these checks create are `zz-fx16-` and are
 * removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx16-setup-code
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server/app.js";
import { authService, currentSetupCode, setupCodeMatches } from "../src/services/auth.service.js";
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

process.env.LOGIN_RATE_LIMIT_MAX = "1000";
delete process.env.SETUP_CODE;
delete process.env.ALLOW_REGISTRATION;

await initDb();

const here = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD = "zz-fx16-password-1";

async function clean(): Promise<void> {
  await pool.query("DELETE FROM users WHERE username LIKE 'zz-fx16-%'");
}
await clean();

// How many accounts the engine believes exist. Everything else is the real code path.
let fakeCount = 0;
const realUserCount = authService.userCount.bind(authService);
authService.userCount = async () => fakeCount;

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let registerCalls = 0;
async function register(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  registerCalls += 1;
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Zaatool-Request": "1" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function rowFor(username: string): Promise<{ role: string } | undefined> {
  const { rows } = await pool.query("SELECT role FROM users WHERE username = $1", [username]);
  return rows[0];
}

console.log("\nthe first account, no accounts yet");

await check("the generated code is six groups of five, 150 bits, and stable until used", () => {
  const { code, chosen } = currentSetupCode();
  assert.equal(chosen, false);
  assert.match(code, /^([A-HJ-NP-Z2-9]{5}-){5}[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(currentSetupCode().code, code, "the code changed between two reads");
});

await check("policy says firstUser, so the form can ask for the code", async () => {
  const res = await fetch(`${base}/api/auth/policy`);
  const body = (await res.json()) as { firstUser: boolean; registrationOpen: boolean };
  assert.equal(body.firstUser, true);
  assert.equal(body.registrationOpen, true);
});

await check("no code: 403, tells the owner where to look, creates nothing", async () => {
  const res = await register({ username: "zz-fx16-nocode", password: PASSWORD });
  assert.equal(res.status, 403);
  assert.match(String(res.body.error), /setup code/i);
  assert.match(String(res.body.error), /logs engine/);
  assert.equal(await rowFor("zz-fx16-nocode"), undefined, "an account was created without the code");
});

await check("wrong code: 403, creates nothing", async () => {
  const { code } = currentSetupCode();
  const wrong = code.slice(0, -1) + (code.endsWith("A") ? "B" : "A");
  const res = await register({ username: "zz-fx16-wrong", password: PASSWORD, setupCode: wrong });
  assert.equal(res.status, 403);
  assert.equal(await rowFor("zz-fx16-wrong"), undefined);
  const notAString = await register({ username: "zz-fx16-wrong", password: PASSWORD, setupCode: 12345 });
  assert.equal(notAString.status, 403);
  const empty = await register({ username: "zz-fx16-wrong", password: PASSWORD, setupCode: "" });
  assert.equal(empty.status, 403);
  assert.equal(await rowFor("zz-fx16-wrong"), undefined);
});

await check("a wrong code is refused before the password is looked at", async () => {
  const res = await register({ username: "zz-fx16-short", password: "short", setupCode: "nope" });
  assert.equal(res.status, 403, "the password rule answered before the code did");
});

let spentCode = "";

await check("the right code makes a creator", async () => {
  const { code } = currentSetupCode();
  spentCode = code;
  const res = await register({ username: "zz-fx16-first", password: PASSWORD, setupCode: ` ${code.toLowerCase()} ` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await rowFor("zz-fx16-first"))?.role, "creator");
});

await check("the code is spent: the next one is a different code", () => {
  assert.notEqual(currentSetupCode().code, spentCode, "the code that worked is still the code");
  assert.equal(setupCodeMatches(spentCode), false);
});

console.log("\nonce there is an account");

await check("the old code means nothing: registration follows the usual rule", async () => {
  fakeCount = 1;
  const { code } = currentSetupCode();
  const refused = await register({ username: "zz-fx16-late", password: PASSWORD, setupCode: code });
  assert.equal(refused.status, 403);
  assert.match(String(refused.body.error), /closed/i, "the code was treated as a key to a closed door");
  assert.equal(await rowFor("zz-fx16-late"), undefined);

  process.env.ALLOW_REGISTRATION = "true";
  try {
    const open = await register({ username: "zz-fx16-open", password: PASSWORD });
    assert.equal(open.status, 201, "an open registration should not ask for a code once someone exists");
    assert.equal((await rowFor("zz-fx16-open"))?.role, "viewer");
  } finally {
    delete process.env.ALLOW_REGISTRATION;
  }
});

await check("policy no longer says firstUser", async () => {
  const res = await fetch(`${base}/api/auth/policy`);
  assert.equal(((await res.json()) as { firstUser: boolean }).firstUser, false);
});

console.log("\nSETUP_CODE");

await check("an operator's code replaces the random one, and is compared exactly", async () => {
  fakeCount = 0;
  process.env.SETUP_CODE = "zz-fx16-chosen-code-123";
  try {
    assert.deepEqual(currentSetupCode(), { code: "zz-fx16-chosen-code-123", chosen: true });
    const random = await register({ username: "zz-fx16-env1", password: PASSWORD, setupCode: "ABCDE-FGHJK" });
    assert.equal(random.status, 403);
    const upper = await register({ username: "zz-fx16-env1", password: PASSWORD, setupCode: "ZZ-FX16-CHOSEN-CODE-123" });
    assert.equal(upper.status, 403, "a chosen code must match case exactly");
    const ok = await register({ username: "zz-fx16-env1", password: PASSWORD, setupCode: "zz-fx16-chosen-code-123" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((await rowFor("zz-fx16-env1"))?.role, "creator");
  } finally {
    delete process.env.SETUP_CODE;
  }
});

console.log("\nthe announcement");

await check("announces once while empty; never prints a chosen code; silent once there are users", async () => {
  fakeCount = 0;
  const lines: string[] = [];
  assert.equal(await authService.announceSetupCode((l) => lines.push(l)), true);
  const text = lines.join("\n");
  assert.match(text, /setup code/i);
  assert.ok(text.includes(currentSetupCode().code), "the random code is not in the log");

  process.env.SETUP_CODE = "zz-fx16-secret-from-env";
  const chosenLines: string[] = [];
  await authService.announceSetupCode((l) => chosenLines.push(l));
  delete process.env.SETUP_CODE;
  assert.ok(!chosenLines.join("\n").includes("zz-fx16-secret-from-env"), "a chosen code was printed");

  fakeCount = 1;
  const silent: string[] = [];
  assert.equal(await authService.announceSetupCode((l) => silent.push(l)), false);
  assert.equal(silent.length, 0);
});

console.log("\nguessing");

await check("registration is rate limited like login", async () => {
  fakeCount = 0;
  const already = registerCalls;
  process.env.LOGIN_RATE_LIMIT_MAX = String(already + 2);
  const statuses: number[] = [];
  for (let i = 0; i < 3; i++) {
    statuses.push((await register({ username: "zz-fx16-guess", password: PASSWORD, setupCode: `GUESS-${i}` })).status);
  }
  assert.deepEqual(statuses, [403, 403, 429]);
  process.env.LOGIN_RATE_LIMIT_MAX = "1000";
});

console.log("\nthe terminal");

await check("pnpm create-user needs no code and still works", async () => {
  fakeCount = 0;
  authService.userCount = realUserCount;
  const result = spawnSync(
    "node",
    ["--import", "tsx", "scripts/create-user.ts", "zz-fx16-cli", "--role", "creator", "--password", PASSWORD],
    { cwd: path.resolve(here, ".."), encoding: "utf8", env: { ...process.env, SETUP_CODE: "" } }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((await rowFor("zz-fx16-cli"))?.role, "creator");
});

await clean();
server.close();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

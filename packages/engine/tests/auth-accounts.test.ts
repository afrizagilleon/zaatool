import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { authService } from "../src/services/auth.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";

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
    console.log(`       ${(err as Error).stack || (err as Error).message}`);
  }
}

await initDb();

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

await pool.query("DELETE FROM users WHERE username LIKE 'zz-test-%'");

await check("T-01: currentUser and setActive manage active state", async () => {
  const created = await authService.createUser("zz-test-t01", "password123", "viewer");
  assert.equal(created.active, true);

  const current = await authService.currentUser(created.id);
  assert.ok(current);
  assert.equal(current.username, "zz-test-t01");
  assert.equal(current.role, "viewer");
  assert.equal(current.active, true);

  const updated = await authService.setActive(created.id, false);
  assert.equal(updated, true);

  const currentInactive = await authService.currentUser(created.id);
  assert.ok(currentInactive);
  assert.equal(currentInactive.active, false);

  await assert.rejects(
    async () => {
      await authService.login("zz-test-t01", "password123");
    },
    (err: unknown) => (err as Error).message === "This account has been deactivated."
  );

  await authService.setActive(created.id, true);
  const loginRes = await authService.login("zz-test-t01", "password123");
  assert.ok(loginRes.token);

  const users = await authService.listUsers();
  const found = users.find((u: { username: string }) => u.username === "zz-test-t01");
  assert.ok(found);
  assert.equal(found.active, true);
});

await check("T-02: authMiddleware re-reads DB role and active status per request", async () => {
  const user = await authService.createUser("zz-test-t02", "password123", "viewer");
  const loginRes = await authService.login("zz-test-t02", "password123");
  const token = loginRes.token;

  // Change role in DB to creator directly
  await authService.setRole("zz-test-t02", "creator");

  // With old token, request creator-only endpoint GET /api/auth/users
  const req1 = await fetch(`${base}/api/auth/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(req1.status, 200, "Should allow request because role in DB is now creator");
  const body1 = await req1.json();
  assert.equal(body1.success, true);

  // Deactivate account in DB
  await authService.setActive(user.id, false);

  // Request with token should now get 403 Deactivated
  const req2 = await fetch(`${base}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(req2.status, 403, "Should reject deactivated account with 403");
  const body2 = await req2.json();
  assert.equal(body2.error, "This account has been deactivated.");
});

await check("T-03: PATCH /api/auth/users/:id deactivates/reactivates accounts and prevents self-deactivation", async () => {
  const creator = await authService.createUser("zz-test-creator1", "password123", "creator");
  const target = await authService.createUser("zz-test-target1", "password123", "viewer");
  await authService.createUser("zz-test-viewer1", "password123", "viewer");

  const creatorLogin = await authService.login("zz-test-creator1", "password123");
  const viewerLogin = await authService.login("zz-test-viewer1", "password123");

  // Deactivate target account
  const patch1 = await fetch(`${base}/api/auth/users/${target.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${creatorLogin.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(patch1.status, 200);
  const body1 = await patch1.json();
  assert.equal(body1.active, false);

  // Reactivate target account
  const patch2 = await fetch(`${base}/api/auth/users/${target.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${creatorLogin.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ active: true }),
  });
  assert.equal(patch2.status, 200);
  const body2 = await patch2.json();
  assert.equal(body2.active, true);

  // Self deactivation attempt by creator
  const patchSelf = await fetch(`${base}/api/auth/users/${creator.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${creatorLogin.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(patchSelf.status, 400);
  const bodySelf = await patchSelf.json();
  assert.equal(bodySelf.error, "You cannot deactivate the account you are signed in as.");

  // Viewer attempt
  const patchViewer = await fetch(`${base}/api/auth/users/${target.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${viewerLogin.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(patchViewer.status, 403);
});

await check("T-04: POST /api/auth/me/password changes self password with current password verification", async () => {
  await authService.createUser("zz-test-pwd1", "password123", "viewer");
  const loginRes = await authService.login("zz-test-pwd1", "password123");

  // Wrong current password attempt
  const wrongReq = await fetch(`${base}/api/auth/me/password`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginRes.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: "wrongpassword",
      newPassword: "newpassword123",
    }),
  });
  assert.equal(wrongReq.status, 400);
  const wrongBody = await wrongReq.json();
  assert.equal(wrongBody.error, "Current password is incorrect");

  // Correct change password attempt
  const correctReq = await fetch(`${base}/api/auth/me/password`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginRes.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: "password123",
      newPassword: "newpassword123",
    }),
  });
  assert.equal(correctReq.status, 200);
  const correctBody = await correctReq.json();
  assert.equal(correctBody.success, true);

  // Login with old password fails
  await assert.rejects(
    async () => {
      await authService.login("zz-test-pwd1", "password123");
    },
    (err: unknown) => (err as Error).message === "Invalid username or password"
  );

  // Login with new password succeeds
  const newLogin = await authService.login("zz-test-pwd1", "newpassword123");
  assert.ok(newLogin.token);
});

await check("T-05: reset-password takes a password, prompts for one, or generates one", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const run = (...args: string[]) => ["--import", "tsx", "scripts/reset-password.ts", ...args];

  await authService.createUser("zz-test-reset1", "password123", "viewer");

  // 1. --password: the caller already knows what they want.
  execFileSync(process.execPath, run("zz-test-reset1", "--password", "flagpass123"), {
    cwd: process.cwd(),
  });
  assert.ok((await authService.login("zz-test-reset1", "flagpass123")).token);

  // 2. --prompt: typed where nobody can read it off the screen or the shell history.
  const prompted = spawnSync(process.execPath, run("zz-test-reset1", "--prompt"), {
    cwd: process.cwd(),
    input: "stdinpass123\n",
    encoding: "utf-8",
  });
  assert.equal(prompted.status, 0);
  assert.ok(!prompted.stdout.includes("stdinpass123"), "typed characters must not be echoed");
  assert.ok((await authService.login("zz-test-reset1", "stdinpass123")).token);

  // 3. No flag: generated, printed once. This is the locked-out path, and it is the
  //    default because a password invented at a prompt in a hurry is the one that gets
  //    shared. FX7 deleted it; it is back.
  const generatedRun = spawnSync(process.execPath, run("zz-test-reset1"), {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  assert.equal(generatedRun.status, 0);
  assert.match(generatedRun.stdout, /Shown once/, "a generated password announces itself");

  const printed = generatedRun.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^[a-zA-Z2-9]{20}$/.test(line));
  assert.ok(printed, `expected a generated password in:\n${generatedRun.stdout}`);
  assert.ok(
    (await authService.login("zz-test-reset1", printed)).token,
    "the password it printed is the password it set"
  );
});

await check("T-06: create-user script creates account with required --role and accepts --password", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");

  // 1. Missing --role fails
  const noRoleProc = spawnSync(process.execPath, ["--import", "tsx", "scripts/create-user.ts", "zz-test-norole", "--password", "password123"], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  assert.notEqual(noRoleProc.status, 0);

  // 2. Success with --role viewer and --password
  const proc = spawnSync(process.execPath, ["--import", "tsx", "scripts/create-user.ts", "zz-test-create1", "--role", "viewer", "--password", "userpass123"], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  assert.equal(proc.status, 0);

  const loginRes = await authService.login("zz-test-create1", "userpass123");
  assert.ok(loginRes.token);
  assert.equal(loginRes.user.role, "viewer");
});

/**
 * R-02 — the account the API sends is the account the shared type describes.
 *
 * `AccountUser` promised `createdAt` while the engine sent `created_at`. Nothing broke,
 * because no screen read it yet — so TypeScript would have gone on insisting the field
 * was a string right up until the first person used it and got `undefined`. jsdom cannot
 * catch that and neither can the compiler: only a test that looks at the wire can.
 */
await check("R-02: the users API sends the field names the shared type promises", async () => {
  const creator = await authService.createUser("zz-test-shape", "password123", "creator");
  const { token } = await authService.login("zz-test-shape", "password123");

  const res = await fetch(`${base}/api/auth/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);

  const body = (await res.json()) as { users: Record<string, unknown>[] };
  const mine = body.users.find((u) => u.id === creator.id);
  assert.ok(mine, "the account that just signed in should be in the list");

  for (const field of ["id", "username", "email", "role", "active", "createdAt"]) {
    assert.ok(field in mine, `AccountUser declares \`${field}\`, so the API must send it`);
  }
  assert.equal("created_at" in mine, false, "the column name stops at the service boundary");
  assert.equal(typeof mine.createdAt, "string", "AccountUser declares createdAt as a string");
  assert.ok(!Number.isNaN(Date.parse(mine.createdAt as string)), "and it must be a real date");
});

await pool.query("DELETE FROM users WHERE username LIKE 'zz-test-%'");

await new Promise<void>((resolve) => server.close(() => resolve()));
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);




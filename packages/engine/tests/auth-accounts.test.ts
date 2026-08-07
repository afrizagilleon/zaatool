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
  const viewer = await authService.createUser("zz-test-viewer1", "password123", "viewer");

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
  const user = await authService.createUser("zz-test-pwd1", "password123", "viewer");
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

await check("T-05: reset-password script accepts --password flag or reads stdin without echo", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");

  await authService.createUser("zz-test-reset1", "password123", "viewer");

  // 1. With --password flag
  execFileSync(process.execPath, ["--import", "tsx", "scripts/reset-password.ts", "zz-test-reset1", "--password", "flagpass123"], {
    cwd: process.cwd(),
  });
  const login1 = await authService.login("zz-test-reset1", "flagpass123");
  assert.ok(login1.token);

  // 2. Interactive prompt via stdin
  const proc = spawnSync(process.execPath, ["--import", "tsx", "scripts/reset-password.ts", "zz-test-reset1"], {
    cwd: process.cwd(),
    input: "stdinpass123\n",
    encoding: "utf-8",
  });
  assert.equal(proc.status, 0);
  assert.ok(!proc.stdout.includes("stdinpass123"), "Characters typed should not be echoed to stdout");

  const login2 = await authService.login("zz-test-reset1", "stdinpass123");
  assert.ok(login2.token);
});


await pool.query("DELETE FROM users WHERE username LIKE 'zz-test-%'");


await new Promise<void>((resolve) => server.close(() => resolve()));
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);




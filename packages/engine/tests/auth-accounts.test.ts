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

await pool.query("DELETE FROM users WHERE username LIKE 'zz-test-%'");
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

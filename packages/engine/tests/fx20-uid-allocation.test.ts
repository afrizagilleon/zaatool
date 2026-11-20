/**
 * FX-20 D-1: every owner gets a sandbox uid of their own, lazily, never shared, and a full
 * range fails with a message that says what to raise.
 *
 *   pnpm --filter @zaa-tool/engine test fx20-uid
 */
import assert from "node:assert/strict";
import { pool } from "../src/db/connection.js";
import { initDb } from "../src/db/initializer.js";
import { forgetSandboxUids, sandboxUidFor, SandboxUidExhaustedError } from "../src/services/sandbox-uid.service.js";
import { testOwner, dropOwner } from "./owners.js";
import type { SandboxConfig } from "../src/core/sandbox-identity.js";

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
const labels = ["fx20u-a", "fx20u-b", "fx20u-c"];
for (const label of labels) await dropOwner(label);

// A range nobody else uses: the real one may already be handed out on this database.
const config: SandboxConfig = { uidBase: 3_000_000, uidCount: 2, gid: 10001, home: "/home/sandbox" };

try {
  const a = await testOwner("fx20u-a");
  const b = await testOwner("fx20u-b");
  const c = await testOwner("fx20u-c");

  await check("a new account has no uid until its first run asks", async () => {
    const { rows } = await pool.query("SELECT sandbox_uid FROM users WHERE id = $1", [a.id]);
    assert.equal(rows[0].sandbox_uid, null);
  });

  await check("the first owner gets the base, and asking again returns the same uid", async () => {
    assert.equal(await sandboxUidFor(a.id, config), 3_000_000);
    assert.equal(await sandboxUidFor(a.id, config), 3_000_000);
    forgetSandboxUids();
    assert.equal(await sandboxUidFor(a.id, config), 3_000_000);
  });

  await check("a second owner gets a different uid, in order", async () => {
    assert.equal(await sandboxUidFor(b.id, config), 3_000_001);
  });

  await check("two first runs at once never share a uid", async () => {
    await pool.query("UPDATE users SET sandbox_uid = NULL WHERE id = ANY($1)", [[a.id, b.id, c.id]]);
    forgetSandboxUids();
    const wide = { ...config, uidCount: 10 };
    const got = await Promise.all([a.id, b.id, c.id].map((id) => sandboxUidFor(id, wide)));
    assert.equal(new Set(got).size, 3, `got ${got.join(",")}`);
  });

  await check("a full range fails with a message that names SANDBOX_UID_COUNT", async () => {
    await pool.query("UPDATE users SET sandbox_uid = NULL WHERE id = ANY($1)", [[a.id, b.id, c.id]]);
    forgetSandboxUids();
    await sandboxUidFor(a.id, config);
    await sandboxUidFor(b.id, config);
    await assert.rejects(
      () => sandboxUidFor(c.id, config),
      (err: unknown) => err instanceof SandboxUidExhaustedError && /SANDBOX_UID_COUNT/.test(err.message)
    );
    const { rows } = await pool.query("SELECT sandbox_uid FROM users WHERE id = $1", [c.id]);
    assert.equal(rows[0].sandbox_uid, null, "a failed allocation left a uid behind");
  });

  await check("the column is UNIQUE: the database refuses a shared uid", async () => {
    await assert.rejects(() => pool.query("UPDATE users SET sandbox_uid = 3000000 WHERE id = $1", [c.id]));
  });
} finally {
  for (const label of labels) await dropOwner(label);
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

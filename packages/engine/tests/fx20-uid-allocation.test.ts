/**
 * FX-20 D-1, S-16: every owner gets a sandbox gid of their own (the column is still
 * `users.sandbox_uid`: the numbers an installation already has stay the owners' numbers),
 * lazily, never shared, and a full range fails with a message that says what to raise.
 *
 *   pnpm --filter @zaa-tool/engine test fx20-uid
 */
import assert from "node:assert/strict";
import { pool } from "../src/db/connection.js";
import { initDb } from "../src/db/initializer.js";
import { forgetSandboxGids, sandboxGidFor, SandboxGidExhaustedError } from "../src/services/sandbox-gid.service.js";
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

/**
 * Starts the test range over. The high-water mark never goes down in real use, so checks
 * that hand the same uids out again after clearing `users` must clear it too.
 */
async function resetRange(ids: string[]): Promise<void> {
  await pool.query("UPDATE users SET sandbox_uid = NULL WHERE id = ANY($1)", [ids]);
  await pool.query("DELETE FROM sandbox_uid_highwater WHERE uid_base = $1", [config.uidBase]);
  forgetSandboxGids();
}
await pool.query("DELETE FROM sandbox_uid_highwater WHERE uid_base = $1", [config.uidBase]);

try {
  const a = await testOwner("fx20u-a");
  const b = await testOwner("fx20u-b");
  const c = await testOwner("fx20u-c");

  await check("a new account has no gid until its first run asks", async () => {
    const { rows } = await pool.query("SELECT sandbox_uid FROM users WHERE id = $1", [a.id]);
    assert.equal(rows[0].sandbox_uid, null);
  });

  await check("the first owner gets the base, and asking again returns the same gid", async () => {
    assert.equal(await sandboxGidFor(a.id, config), 3_000_000);
    assert.equal(await sandboxGidFor(a.id, config), 3_000_000);
    forgetSandboxGids();
    assert.equal(await sandboxGidFor(a.id, config), 3_000_000);
  });

  await check("a second owner gets a different gid, in order", async () => {
    assert.equal(await sandboxGidFor(b.id, config), 3_000_001);
  });

  await check("two first runs at once never share a gid", async () => {
    await resetRange([a.id, b.id, c.id]);
    const wide = { ...config, uidCount: 10 };
    const got = await Promise.all([a.id, b.id, c.id].map((id) => sandboxGidFor(id, wide)));
    assert.equal(new Set(got).size, 3, `got ${got.join(",")}`);
  });

  await check("a full range fails with a message that names SANDBOX_UID_COUNT", async () => {
    await resetRange([a.id, b.id, c.id]);
    await sandboxGidFor(a.id, config);
    await sandboxGidFor(b.id, config);
    await assert.rejects(
      () => sandboxGidFor(c.id, config),
      (err: unknown) => err instanceof SandboxGidExhaustedError && /SANDBOX_UID_COUNT/.test(err.message)
    );
    const { rows } = await pool.query("SELECT sandbox_uid FROM users WHERE id = $1", [c.id]);
    assert.equal(rows[0].sandbox_uid, null, "a failed allocation left a gid behind");
  });

  await check("the column is UNIQUE: the database refuses a shared gid", async () => {
    await assert.rejects(() => pool.query("UPDATE users SET sandbox_uid = 3000000 WHERE id = $1", [c.id]));
  });

  await check("deleting the newest owner does not hand its gid to the next one", async () => {
    await resetRange([a.id, b.id, c.id]);
    const wide = { ...config, uidCount: 10 };
    assert.equal(await sandboxGidFor(a.id, wide), 3_000_000);
    assert.equal(await sandboxGidFor(b.id, wide), 3_000_001);
    await dropOwner("fx20u-b");
    forgetSandboxGids();
    const next = await testOwner("fx20u-d");
    assert.equal(await sandboxGidFor(next.id, wide), 3_000_002, "the deleted owner's gid was given out again");
  });
} finally {
  for (const label of [...labels, "fx20u-d"]) await dropOwner(label);
  await pool.query("DELETE FROM sandbox_uid_highwater WHERE uid_base = $1", [config.uidBase]);
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

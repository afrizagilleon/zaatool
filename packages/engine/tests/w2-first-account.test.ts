/**
 * C-12 — the first account is made once, and a taken username is said in words.
 *
 * On an empty installation, six registrations that all carried the right setup code each
 * read "no accounts yet" and each became a creator. And two accounts made with the same
 * username at once ended in the database's own error, shown to the caller as a 500.
 *
 * The suite's database is never empty (other tests keep accounts in it), so "the
 * installation has no accounts" is true here of the accounts this file makes — everything
 * it makes is prefixed `zz-w2first-` — by narrowing what `userCount` counts. The count is
 * still read through whatever connection it is handed, which is the whole point: a count
 * read inside the lock sees the account somebody else just committed.
 *
 *   pnpm --filter @zaa-tool/engine test w2-first-account
 */
import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import {
  authService,
  AuthInputError,
  RegistrationClosedError,
  currentSetupCode,
} from "../src/services/auth.service.js";

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
    console.log(`       ${(err as Error).message.split("\n").join("\n       ")}`);
  }
}

await initDb();
delete process.env.ALLOW_REGISTRATION;
const PASSWORD = "zz-w2first-password-long";

const clean = () => pool.query("DELETE FROM users WHERE username LIKE 'zz-w2first-%'");
await clean();

const realCount = authService.userCount.bind(authService);
authService.userCount = async (db: Parameters<typeof realCount>[0] = pool) => {
  const { rows } = await db.query("SELECT COUNT(*) FROM users WHERE username LIKE 'zz-w2first-%'");
  return Number.parseInt(rows[0].count, 10);
};

console.log("\nthe first account");

await check("six registrations with the right code on an empty installation make one creator", async () => {
  const code = currentSetupCode().code;
  const outcomes = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) => authService.register(`zz-w2first-r${i}`, PASSWORD, undefined, code))
  );
  const made = outcomes.filter((o) => o.status === "fulfilled");
  assert.equal(made.length, 1, `${made.length} accounts were made`);
  const { rows } = await pool.query("SELECT role FROM users WHERE username LIKE 'zz-w2first-r%'");
  assert.deepEqual(rows.map((row) => row.role), ["creator"]);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") assert.ok(outcome.reason instanceof RegistrationClosedError, String(outcome.reason));
  }
});

await check("with registration propped open, the others become viewers, never a second creator", async () => {
  await clean();
  process.env.ALLOW_REGISTRATION = "true";
  try {
    const code = currentSetupCode().code;
    await Promise.all(Array.from({ length: 5 }, (_, i) => authService.register(`zz-w2first-o${i}`, PASSWORD, undefined, code)));
    const { rows } = await pool.query("SELECT role FROM users WHERE username LIKE 'zz-w2first-o%'");
    assert.equal(rows.filter((row) => row.role === "creator").length, 1);
    assert.equal(rows.length, 5);
  } finally {
    delete process.env.ALLOW_REGISTRATION;
  }
});

console.log("\na username that is taken");

await check("four accounts of one name at once: one is made, the rest are told the name is taken", async () => {
  await clean();
  const outcomes = await Promise.allSettled(
    Array.from({ length: 4 }, () => authService.createUser("zz-w2first-dup", PASSWORD, "viewer"))
  );
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  for (const outcome of outcomes) {
    if (outcome.status !== "rejected") continue;
    assert.ok(outcome.reason instanceof AuthInputError, `not a message a person can act on: ${String(outcome.reason)}`);
    assert.equal(outcome.reason.message, "Username already taken");
  }
});

await check("the same name racing through register is also a plain refusal", async () => {
  await clean();
  process.env.ALLOW_REGISTRATION = "true";
  try {
    await authService.createUser("zz-w2first-existing", PASSWORD, "creator");
    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () => authService.register("zz-w2first-same", PASSWORD))
    );
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") assert.ok(outcome.reason instanceof AuthInputError, String(outcome.reason));
    }
  } finally {
    delete process.env.ALLOW_REGISTRATION;
  }
});

authService.userCount = realCount;
await clean();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

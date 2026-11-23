/**
 * C-13 — the secrets key cannot be rotated under a running engine, and the engine looks at
 * every secret at start.
 *
 * Rotating while an engine ran made every secret that engine saved afterwards unreadable (it
 * kept the old key in memory), and start-up proved the key against one row only, so a row
 * sealed under another key sat undetected beside rows that opened fine.
 *
 * The engine's lock is taken in the test process the way `server-entry` takes it; the
 * rotation is the real script, run as its own process with its own connection.
 *
 * Everything it makes is prefixed `ZZ_W2LOCK_` (secrets) or `zz-own-w2lock` (the account) and
 * removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test w2-secrets-lock
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initDb } from "../src/db/initializer.js";
import { pool, connectionOptions } from "../src/db/connection.js";
import { LOCK_KEYS } from "../src/core/advisory-locks.js";
import { encryptValue, parseSecretsKey } from "../src/core/secrets-crypto.js";
import { secretsService, SecretsKeyMismatchError, EngineRunningError } from "../src/services/secrets.service.js";
import { holdEngineLock, RotationInProgressError } from "../src/services/engine-lock.service.js";
import { dropOwner, testOwner } from "./owners.js";

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

const KEY_A = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
const KEY_B = "b".repeat(32) + "fedcba9876543210fedcba9876543210";
const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(here, "..");

await initDb();
const alice = await testOwner("w2lock");
const clean = () => pool.query("DELETE FROM secrets WHERE key LIKE 'ZZ_W2LOCK_%'");
await clean();

const seal = (key: string, value: string, withKey: string): string =>
  encryptValue(parseSecretsKey(withKey)!, alice.id, key, value);

async function insert(id: string, key: string, value: string, withKey: string): Promise<void> {
  await pool.query("INSERT INTO secrets (id, key, value, is_secret, owner_id) VALUES ($1, $2, $3, true, $4)", [
    id,
    key,
    seal(key, value, withKey),
    alice.id,
  ]);
}

const snapshot = async (): Promise<string> =>
  JSON.stringify((await pool.query("SELECT id, value FROM secrets WHERE key LIKE 'ZZ_W2LOCK_%' ORDER BY id")).rows);

function rotate(): { code: number; out: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(engineDir, "scripts", "rotate-secrets-key.ts")], {
    cwd: engineDir,
    encoding: "utf8",
    env: { ...process.env, SECRETS_KEY: KEY_A, NEW_SECRETS_KEY: KEY_B },
  });
  return { code: result.status ?? 1, out: `${result.stdout}${result.stderr}` };
}

await insert("zz-w2lock-1", "ZZ_W2LOCK_1", "one", KEY_A);
await insert("zz-w2lock-2", "ZZ_W2LOCK_2", "two", KEY_A);

console.log("\nthe lock");

await check("an engine will not start while a rotation holds the database", async () => {
  const rotation = new pg.Client(connectionOptions());
  await rotation.connect();
  try {
    await rotation.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_KEYS.engineAlive]);
    await assert.rejects(holdEngineLock(), RotationInProgressError);
  } finally {
    await rotation.end();
  }
});

await check("with no engine up, the rotation runs", async () => {
  const before = await snapshot();
  const result = rotate();
  assert.equal(result.code, 0, result.out);
  assert.notEqual(await snapshot(), before);
  // Put back what the next cases expect: sealed under A.
  await pool.query("DELETE FROM secrets WHERE key LIKE 'ZZ_W2LOCK_%'");
  await insert("zz-w2lock-1", "ZZ_W2LOCK_1", "one", KEY_A);
  await insert("zz-w2lock-2", "ZZ_W2LOCK_2", "two", KEY_A);
});

await check("with an engine up, the rotation script refuses, says why, and changes nothing", async () => {
  await holdEngineLock();
  const before = await snapshot();
  const result = rotate();
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /engine is running/i);
  assert.match(result.out, /docker compose stop engine/);
  assert.equal(await snapshot(), before, "the rows changed under a running engine");
  await assert.rejects(secretsService.rotateKey(parseSecretsKey(KEY_A)!, parseSecretsKey(KEY_B)!), EngineRunningError);
});

await check("the engine's start-up path takes the lock before it touches the secrets", () => {
  const entry = fs.readFileSync(path.join(engineDir, "src", "server-entry.ts"), "utf8");
  const lock = entry.indexOf("holdEngineLock()");
  const protect = entry.indexOf("secretsService.protectAtStart()");
  assert.ok(lock > 0 && protect > 0 && lock < protect, "server-entry does not hold the lock before protectAtStart");
});

console.log("\nevery row is checked at start");

await check("one row sealed under another key stops the start and is named by its id", async () => {
  await insert("zz-w2lock-3", "ZZ_W2LOCK_3", "three", KEY_A);
  await insert("zz-w2lock-bad", "ZZ_W2LOCK_BAD", "sealed elsewhere", KEY_B);
  const saved = process.env.SECRETS_KEY;
  process.env.SECRETS_KEY = KEY_A;
  try {
    const failure = await secretsService.protectAtStart().then(
      () => null,
      (err: unknown) => err
    );
    assert.ok(failure instanceof SecretsKeyMismatchError, `start went ahead: ${String(failure)}`);
    assert.deepEqual(failure.failedIds, ["zz-w2lock-bad"]);
    assert.match(failure.message, /zz-w2lock-bad/);
    assert.doesNotMatch(failure.message, /zz-w2lock-1\b/, "a row that opens was reported");
    assert.doesNotMatch(failure.message, /sealed elsewhere/, "a value was reported");
  } finally {
    if (saved === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = saved;
  }
});

await clean();
await dropOwner("w2lock");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

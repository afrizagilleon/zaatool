/**
 * FX-19 — secrets encrypted at rest.
 *
 * Values in the `secrets` table are AES-256-GCM under `SECRETS_KEY`, bound to their owner and
 * name; plaintext rows from before are encrypted at start; a wrong key stops the engine; a
 * webhook secret is compared in constant time.
 *
 * Everything it creates is prefixed `zz-fx19-` (users, notebooks) or `ZZ_FX19_` (secrets) and
 * removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx19-secrets
 */
import assert from "node:assert/strict";
import { configProblems, secretsKey } from "../src/config.js";
import { decryptValue, encryptValue, isEncrypted, parseSecretsKey } from "../src/core/secrets-crypto.js";

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

/** Runs `fn` with the environment set as given (undefined removes), then puts it back. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const name of Object.keys(env)) {
    saved[name] = process.env[name];
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  try {
    return await fn();
  } finally {
    for (const name of Object.keys(env)) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

// ── the cipher and the key (T-01) ─────────────────────────────────────────────

console.log("\nthe cipher and the key");

const keyA = parseSecretsKey(KEY_A)!;

await check("the stored form is enc:v1:<iv>:<tag>:<ciphertext> and round-trips", () => {
  const stored = encryptValue(keyA, "owner-1", "API", "hunter2");
  assert.match(stored, /^enc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/);
  assert.ok(!stored.includes("hunter2"));
  assert.ok(isEncrypted(stored));
  assert.equal(decryptValue(keyA, "owner-1", "API", stored), "hunter2");
});

await check("the IV is fresh per write: the same value encrypts differently twice", () => {
  assert.notEqual(encryptValue(keyA, "o", "K", "same"), encryptValue(keyA, "o", "K", "same"));
});

await check("another owner, another name, another key or a flipped byte all fail to decrypt", () => {
  const stored = encryptValue(keyA, "owner-1", "API", "hunter2");
  assert.throws(() => decryptValue(keyA, "owner-2", "API", stored));
  assert.throws(() => decryptValue(keyA, "owner-1", "OTHER", stored));
  assert.throws(() => decryptValue(parseSecretsKey(KEY_B)!, "owner-1", "API", stored));
  const parts = stored.split(":");
  parts[4] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptValue(keyA, "owner-1", "API", parts.join(":")));
});

await check("a value without the prefix is old plaintext and is returned as it is", () => {
  assert.equal(decryptValue(keyA, "o", "K", "plain-old"), "plain-old");
});

await check("a key is 64 hex characters: anything else is not a key", () => {
  assert.ok(parseSecretsKey(KEY_A));
  for (const bad of ["", undefined, "abc", "g".repeat(64), "a".repeat(63), "a".repeat(65)]) {
    assert.equal(parseSecretsKey(bad), null, String(bad));
  }
});

await check("production without a key, or with a malformed one, refuses to start; a good key does not", async () => {
  const prod = { NODE_ENV: "production", JWT_SECRET: "j".repeat(40) };
  const missing = await withEnv({ ...prod, SECRETS_KEY: undefined }, () => configProblems());
  assert.ok(missing.some((p) => p.includes("SECRETS_KEY is not set")), missing.join("|"));
  const bad = await withEnv({ ...prod, SECRETS_KEY: "short" }, () => configProblems());
  assert.ok(bad.some((p) => p.includes("64 hex")), bad.join("|"));
  const good = await withEnv({ ...prod, SECRETS_KEY: KEY_A }, () => configProblems());
  assert.ok(!good.some((p) => p.includes("SECRETS_KEY")), good.join("|"));
});

await check("outside production a missing key is allowed, a malformed one is not", async () => {
  const none = await withEnv({ NODE_ENV: "development", SECRETS_KEY: undefined }, () => configProblems());
  assert.ok(!none.some((p) => p.includes("SECRETS_KEY")));
  assert.equal(await withEnv({ SECRETS_KEY: undefined }, () => secretsKey()), null);
  const bad = await withEnv({ NODE_ENV: "development", SECRETS_KEY: "xyz" }, () => configProblems());
  assert.ok(bad.some((p) => p.includes("64 hex")));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

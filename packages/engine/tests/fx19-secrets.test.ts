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
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AddressInfo } from "node:net";
import { configProblems, secretsKey } from "../src/config.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { createApp } from "../src/server/app.js";
import { secretsService, SecretsKeyMismatchError } from "../src/services/secrets.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { dropOwner, testOwner } from "./owners.js";
import type { NotebookJson } from "@zaa-tool/shared";
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

// ── the database (T-02) ───────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(here, "..");

async function clean(): Promise<void> {
  await pool.query("DELETE FROM notebook_runs WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx19-%')");
  await pool.query("DELETE FROM notebook_triggers WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx19-%')");
  await pool.query("UPDATE notebooks SET deployed_version_id = NULL WHERE name LIKE 'zz-fx19-%'");
  await pool.query("DELETE FROM notebook_versions WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx19-%')");
  await pool.query("DELETE FROM notebooks WHERE name LIKE 'zz-fx19-%'");
  await pool.query("DELETE FROM secrets WHERE key LIKE 'ZZ_FX19_%'");
  await dropOwner("fx19a");
  await dropOwner("fx19b");
  await dropOwner("fx19c");
}

/** The stored form, straight from SQL: what a dump of the database would contain. */
async function rawValue(ownerId: string, key: string): Promise<string> {
  const { rows } = await pool.query("SELECT value FROM secrets WHERE owner_id = $1 AND key = $2", [ownerId, key]);
  return rows[0]?.value;
}

async function insertPlain(ownerId: string, key: string, value: string, isSecret = true): Promise<void> {
  await pool.query("INSERT INTO secrets (id, key, value, is_secret, owner_id) VALUES ($1, $2, $3, $4, $5)", [
    `zz-fx19-${key}-${ownerId.slice(0, 6)}`,
    key,
    value,
    isSecret,
    ownerId,
  ]);
}

process.env.SECRETS_KEY = KEY_A;
await initDb();
await clean();
const alice = await testOwner("fx19a");
const bob = await testOwner("fx19b");

console.log("\nstored encrypted, read decrypted");

await check("a secret is stored as ciphertext: no plaintext anywhere in the row", async () => {
  await secretsService.create(alice.id, "ZZ_FX19_TOKEN", "plain-needle-1", true);
  await secretsService.create(alice.id, "ZZ_FX19_NOTE", "plain-needle-2", false);
  for (const [key, needle] of [["ZZ_FX19_TOKEN", "plain-needle-1"], ["ZZ_FX19_NOTE", "plain-needle-2"]]) {
    const { rows } = await pool.query("SELECT secrets::text AS whole FROM secrets WHERE owner_id = $1 AND key = $2", [alice.id, key]);
    assert.ok(!rows[0].whole.includes(needle), `${key} is readable in the table: ${rows[0].whole}`);
    assert.ok((await rawValue(alice.id, key)).startsWith("enc:v1:"));
  }
});

await check("it reads back: by key, by name, and in the list (a secret stays masked, a plain value shows)", async () => {
  assert.deepEqual(await secretsService.getByKeys(alice.id, ["ZZ_FX19_TOKEN", "ZZ_FX19_NOTE"]), {
    ZZ_FX19_TOKEN: "plain-needle-1",
    ZZ_FX19_NOTE: "plain-needle-2",
  });
  assert.equal(await secretsService.getValueByKey(alice.id, "ZZ_FX19_TOKEN"), "plain-needle-1");
  const list = (await secretsService.getAll(alice.id)) as { key: string; value: string }[];
  assert.equal(list.find((row) => row.key === "ZZ_FX19_TOKEN")?.value, "******");
  assert.equal(list.find((row) => row.key === "ZZ_FX19_NOTE")?.value, "plain-needle-2");
});

await check("an update re-encrypts, and a rename keeps the value readable under the new name", async () => {
  const [row] = (await secretsService.getAll(alice.id)).filter((r: { key: string }) => r.key === "ZZ_FX19_TOKEN");
  const before = await rawValue(alice.id, "ZZ_FX19_TOKEN");
  await secretsService.update(alice.id, row.id, "ZZ_FX19_RENAMED", "plain-needle-3", true);
  assert.notEqual(await rawValue(alice.id, "ZZ_FX19_RENAMED"), before);
  assert.equal(await secretsService.getValueByKey(alice.id, "ZZ_FX19_RENAMED"), "plain-needle-3");
  assert.equal(await secretsService.getValueByKey(alice.id, "ZZ_FX19_TOKEN"), null);
});

await check("the same key for two owners is two values, each readable by its owner only", async () => {
  await secretsService.create(bob.id, "ZZ_FX19_RENAMED", "bobs-value", true);
  assert.equal(await secretsService.getValueByKey(bob.id, "ZZ_FX19_RENAMED"), "bobs-value");
  assert.equal(await secretsService.getValueByKey(alice.id, "ZZ_FX19_RENAMED"), "plain-needle-3");
});

await check("AAD: ciphertext copied onto another owner's row does not decrypt", async () => {
  const stolen = await rawValue(alice.id, "ZZ_FX19_RENAMED");
  await pool.query("UPDATE secrets SET value = $1 WHERE owner_id = $2 AND key = 'ZZ_FX19_RENAMED'", [stolen, bob.id]);
  await assert.rejects(secretsService.getValueByKey(bob.id, "ZZ_FX19_RENAMED"));
  await pool.query("UPDATE secrets SET value = $1 WHERE owner_id = $2 AND key = 'ZZ_FX19_RENAMED'", [
    sealFor(bob.id, "ZZ_FX19_RENAMED", "bobs-value"),
    bob.id,
  ]);
  assert.equal(await secretsService.getValueByKey(bob.id, "ZZ_FX19_RENAMED"), "bobs-value");
});

function sealFor(ownerId: string, key: string, value: string, hex = KEY_A): string {
  return encryptValue(parseSecretsKey(hex)!, ownerId, key, value);
}

await check("a notebook run is given the decrypted value", async () => {
  await secretsService.create(alice.id, "ZZ_FX19_RUN", "value-for-the-cell", true);
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name: "zz-fx19-run",
      runtime: "node",
      secrets: ["ZZ_FX19_RUN"],
      outputs: ["got"],
      steps: [{ id: "c1", kind: "cell", code: "return { got: process.env.ZZ_FX19_RUN ?? null };" }],
    } as NotebookJson,
    "test",
    alice.id
  );
  const started = await notebookExecutionService.start(saved.id, () => {}, {});
  const outcome = await started.completed;
  assert.equal(outcome.status, "success", JSON.stringify(outcome));
  assert.equal((outcome.outputs as { got: unknown }).got, "value-for-the-cell");
});

console.log("\nplaintext from before: encrypted at start");

await check("protectAtStart encrypts every plaintext row, and a second pass finds nothing", async () => {
  await insertPlain(alice.id, "ZZ_FX19_OLD1", "old-plain-1");
  await insertPlain(bob.id, "ZZ_FX19_OLD2", "old-plain-2", false);
  assert.equal(await secretsService.protectAtStart(), 2);
  assert.ok((await rawValue(alice.id, "ZZ_FX19_OLD1")).startsWith("enc:v1:"));
  assert.ok((await rawValue(bob.id, "ZZ_FX19_OLD2")).startsWith("enc:v1:"));
  assert.equal(await secretsService.getValueByKey(alice.id, "ZZ_FX19_OLD1"), "old-plain-1");
  assert.equal(await secretsService.getValueByKey(bob.id, "ZZ_FX19_OLD2"), "old-plain-2");
  assert.equal(await secretsService.protectAtStart(), 0);
});

await check("a wrong key is refused before anything is written, and nothing is overwritten", async () => {
  await insertPlain(alice.id, "ZZ_FX19_OLD3", "old-plain-3");
  const encryptedBefore = await rawValue(alice.id, "ZZ_FX19_RUN");
  await withEnv({ SECRETS_KEY: KEY_B }, async () => {
    await assert.rejects(secretsService.protectAtStart(), SecretsKeyMismatchError);
  });
  assert.equal(await rawValue(alice.id, "ZZ_FX19_OLD3"), "old-plain-3", "the plaintext row was touched");
  assert.equal(await rawValue(alice.id, "ZZ_FX19_RUN"), encryptedBefore, "an encrypted row was overwritten");
  assert.equal(await secretsService.protectAtStart(), 1);
});

/** Starts server-entry; resolves when `until` appears in its output (then kills it) or when it exits. */
function engine(env: Record<string, string | undefined>, until?: RegExp): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    for (const name of Object.keys(env)) if (env[name] === undefined) delete childEnv[name];
    const child = spawn(process.execPath, ["--import", "tsx", path.join(engineDir, "src/server-entry.ts")], {
      cwd: engineDir,
      env: childEnv,
    });
    let out = "";
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out });
    };
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (until && until.test(out)) {
        child.kill();
        finish(null);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => finish(code));
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 60_000);
  });
}

console.log("\nthe engine's start");

const PROD = { NODE_ENV: "production", JWT_SECRET: "j".repeat(40) };

await check("production without SECRETS_KEY refuses to start", async () => {
  const result = await engine({ ...PROD, SECRETS_KEY: undefined });
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /SECRETS_KEY is not set/);
});

await check("a key that does not open the encrypted rows refuses to start, and changes nothing", async () => {
  const before = await rawValue(alice.id, "ZZ_FX19_RUN");
  const result = await engine({ SECRETS_KEY: KEY_B });
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /SECRETS_KEY tidak cocok dengan secret di database/);
  assert.equal(await rawValue(alice.id, "ZZ_FX19_RUN"), before);
});

await check("the right key starts, and encrypts a plaintext row on the way", async () => {
  await insertPlain(bob.id, "ZZ_FX19_AT_START", "plain-at-start");
  const result = await engine({ SECRETS_KEY: KEY_A }, /Server listening|already in use/);
  assert.doesNotMatch(result.out, /Refusing to start/);
  assert.match(result.out, /Encrypted [0-9]+ secret/);
  assert.ok((await rawValue(bob.id, "ZZ_FX19_AT_START")).startsWith("enc:v1:"));
});

await check("outside production with no key it starts, warns once, and leaves plaintext alone", async () => {
  await insertPlain(bob.id, "ZZ_FX19_DEV", "plain-in-dev");
  const result = await engine({ SECRETS_KEY: undefined, NODE_ENV: "development" }, /Server listening|already in use/);
  assert.doesNotMatch(result.out, /Refusing to start/);
  assert.equal(result.out.split("SECRETS_KEY is not set").length - 1, 1, result.out);
  assert.equal(await rawValue(bob.id, "ZZ_FX19_DEV"), "plain-in-dev");
});


// ── the webhook secret (T-03) ─────────────────────────────────────────────────

console.log("\nwebhook secret");

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

await check("the stored (encrypted) secret opens a webhook; a wrong, missing or prefix-only one does not", async () => {
  await secretsService.create(alice.id, "ZZ_FX19_HOOK", "correct-horse-battery", true);
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name: "zz-fx19-hook",
      runtime: "node",
      outputs: ["ok"],
      triggers: [{ id: "zz-fx19-trig", kind: "webhook", slug: "zz-fx19-hook-slug", secretKey: "ZZ_FX19_HOOK" }],
      steps: [{ id: "c1", kind: "cell", code: "return { ok: true };" }],
    } as NotebookJson,
    "test",
    alice.id
  );
  await notebooksService.deploy(saved.id, "test");
  assert.ok((await rawValue(alice.id, "ZZ_FX19_HOOK")).startsWith("enc:v1:"));

  const post = (secret?: string) =>
    fetch(`${base}/hooks/zz-fx19-hook-slug`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret === undefined ? {} : { "X-Webhook-Secret": secret }) },
      body: "{}",
    });
  const good = await post("correct-horse-battery");
  assert.equal(good.status, 200, await good.clone().text());
  assert.equal((await post("wrong")).status, 401);
  assert.equal((await post("correct-horse-batter")).status, 401);
  assert.equal((await post("correct-horse-battery-and-more")).status, 401);
  assert.equal((await post("")).status, 401);
  assert.equal((await post()).status, 401);
});

server.close();


await clean();
await pool.end();

console.log(`
${passed} passed, ${failed} failed
`);
process.exit(failed === 0 ? 0 : 1);

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

/**
 * The login limiter counts per client address. Behind nginx (production) or the Vite proxy
 * (development) that address is only in `X-Forwarded-For`; with Express's `trust proxy`
 * unset, `req.ip` was the proxy for everybody and ten wrong passwords from anyone locked
 * every user out. These tests stand in for the proxy: requests come from loopback and
 * carry a forwarded address, and the question is whose bucket they land in.
 *
 * Every username is `zz-k09-…` and does not exist, so no rows are written. The limiter's
 * store lives in the module, shared by every app in this process, so each test uses
 * addresses of its own. `trust proxy` is read when `createApp` runs, which is why the
 * TRUST_PROXY=false case can share the process with the others.
 */
process.env.LOGIN_RATE_LIMIT_MAX = "3";
delete process.env.TRUST_PROXY;

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

const { createApp } = await import("../src/server/app.js");

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const app = createApp(() => {});
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

async function login(base: string, forwardedFor?: string): Promise<number> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    body: JSON.stringify({ username: "zz-k09-nobody", password: "wrong-password-1" }),
  });
  return res.status;
}

console.log("\nrate-limit-proxy (login limiter sees the client, not the proxy)");

await check("default: two clients behind a loopback proxy get separate login buckets", async () => {
  await withServer(async (base) => {
    for (let i = 0; i < 3; i++) assert.notEqual(await login(base, "203.0.113.1"), 429, `A attempt ${i + 1}`);
    assert.equal(await login(base, "203.0.113.1"), 429, "A is limited after its 3 attempts");
    assert.notEqual(await login(base, "203.0.113.2"), 429, "B is not limited by A");
  });
});

await check("default: one client is still limited, and a spoofed leading hop does not reset it", async () => {
  await withServer(async (base) => {
    // nginx appends the real peer on the right; a client can only prepend its own claims.
    for (let i = 0; i < 3; i++) assert.notEqual(await login(base, `198.51.100.${i}, 203.0.113.50`), 429);
    assert.equal(await login(base, "198.51.100.99, 203.0.113.50"), 429);
  });
});

await check("TRUST_PROXY=false: X-Forwarded-For is ignored, everyone shares one bucket", async () => {
  process.env.TRUST_PROXY = "false";
  try {
    await withServer(async (base) => {
      for (let i = 0; i < 3; i++) assert.notEqual(await login(base, `192.0.2.${i + 1}`), 429);
      assert.equal(await login(base, "192.0.2.200"), 429, "a new forwarded address does not get a new bucket");
    });
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
try {
  const { pool } = await import("../src/db/connection.js");
  await pool.end();
} catch {
  // nothing to close
}
process.exit(failed === 0 ? 0 : 1);

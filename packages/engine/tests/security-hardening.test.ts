import assert from "node:assert/strict";
import { corsPolicy } from "../src/server/app.js";

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

console.log("\nsecurity-hardening (T-01: CORS verification)");

await check("CORS policy in production with empty CORS_ORIGINS returns origin: false", () => {
  const oldEnv = process.env.NODE_ENV;
  const oldCors = process.env.CORS_ORIGINS;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGINS;
    const policy = corsPolicy();
    assert.deepEqual(policy, { origin: false });
  } finally {
    process.env.NODE_ENV = oldEnv;
    if (oldCors !== undefined) process.env.CORS_ORIGINS = oldCors;
    else delete process.env.CORS_ORIGINS;
  }
});

await check("CORS policy in production with declared CORS_ORIGINS returns list and credentials", () => {
  const oldEnv = process.env.NODE_ENV;
  const oldCors = process.env.CORS_ORIGINS;
  try {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://a.com,https://b.com";
    const policy = corsPolicy();
    assert.deepEqual(policy, { origin: ["https://a.com", "https://b.com"], credentials: true });
  } finally {
    process.env.NODE_ENV = oldEnv;
    if (oldCors !== undefined) process.env.CORS_ORIGINS = oldCors;
    else delete process.env.CORS_ORIGINS;
  }
});

await check("CORS policy in development with empty CORS_ORIGINS returns origin: true and credentials: true", () => {
  const oldEnv = process.env.NODE_ENV;
  const oldCors = process.env.CORS_ORIGINS;
  try {
    process.env.NODE_ENV = "development";
    delete process.env.CORS_ORIGINS;
    const policy = corsPolicy();
    assert.deepEqual(policy, { origin: true, credentials: true });
  } finally {
    process.env.NODE_ENV = oldEnv;
    if (oldCors !== undefined) process.env.CORS_ORIGINS = oldCors;
    else delete process.env.CORS_ORIGINS;
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);

console.log("\nsecurity-hardening (T-02: Login rate limiting)");

await check("login rate limiter returns 429 after exceeding LOGIN_RATE_LIMIT_MAX", async () => {
  const { createApp } = await import("../src/server/app.js");
  const { initDb } = await import("../src/db/initializer.js");
  const { pool } = await import("../src/db/connection.js");

  await initDb();
  process.env.LOGIN_RATE_LIMIT_MAX = "2";

  const app = createApp(() => {});

  // Simulate requests using supertest-like fetch against app/http server or mocked req/res
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const res1 = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "wrong-password-123" }),
    });
    assert.equal(res1.status, 401);

    const res2 = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "wrong-password-123" }),
    });
    assert.equal(res2.status, 401);

    const res3 = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "wrong-password-123" }),
    });
    assert.equal(res3.status, 429);
  } finally {
    server.close();
    delete process.env.LOGIN_RATE_LIMIT_MAX;
    await pool.end();
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);


import assert from "node:assert/strict";
import { pool } from "../src/db/connection.js";
import { authController } from "../src/controllers/auth.controller.js";
import { initDb } from "../src/db/initializer.js";
import { authService } from "../src/services/auth.service.js";

const PREFIX = "zz-db-resilience-";
const TEST_PASSWORD = "password123456";

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
await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);

console.log("\ndb-resilience (T-01: Pool error handling)");

await check("pool.emit('error') does not throw unhandled exception or crash process", () => {
  let loggedError: unknown = null;
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    loggedError = args.join(" ");
  };
  try {
    const err = new Error("simulated pool connection loss");
    assert.doesNotThrow(() => {
      pool.emit("error", err);
    });
    assert.ok(
      String(loggedError).includes("simulated pool connection loss"),
      "expected error to be logged via console.error"
    );
  } finally {
    console.error = origConsoleError;
  }
});

console.log("\ndb-resilience (T-02: Internal error masking)");

await check("login returns 401 for invalid credentials with explicit user message", async () => {
  const req = { body: { username: `${PREFIX}user-nonexistent`, password: TEST_PASSWORD } } as any;
  let statusResult = 0;
  let jsonResult: any = null;
  const res = {
    status(s: number) {
      statusResult = s;
      return this;
    },
    json(body: any) {
      jsonResult = body;
      return this;
    },
  } as any;

  await authController.login(req, res);
  assert.equal(statusResult, 401);
  assert.equal(jsonResult?.error, "Invalid username or password");
});

await check("login returns 500 with generic message and logs error when DB fails", async () => {
  let loggedError = "";
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    loggedError = args.join(" ");
  };

  // Temporarily stub pool.query to simulate DB connection failure
  const origQuery = pool.query;
  (pool as any).query = async () => {
    throw new Error("getaddrinfo ENOTFOUND postgres");
  };

  try {
    const req = { body: { username: `${PREFIX}user`, password: TEST_PASSWORD } } as any;
    let statusResult = 0;
    let jsonResult: any = null;
    const res = {
      status(s: number) {
        statusResult = s;
        return this;
      },
      json(body: any) {
        jsonResult = body;
        return this;
      },
    } as any;

    await authController.login(req, res);

    assert.equal(statusResult, 500);
    assert.equal(jsonResult?.error, "Something went wrong. Please try again.");
    assert.ok(
      loggedError.includes("getaddrinfo ENOTFOUND postgres"),
      "expected server to log internal error details"
    );
  } finally {
    pool.query = origQuery;
    console.error = origConsoleError;
  }
});

await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

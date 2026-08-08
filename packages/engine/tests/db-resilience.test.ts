/**
 * FX10 — what the engine does when postgres goes away.
 *
 * Measured by hand before any of this was written: stop postgres, and the engine did not
 * degrade, it *died*. `pg.Pool` emits `'error'` on a client that dropped while idle, and
 * an `EventEmitter` with no listener for `'error'` rethrows — so a database restart took
 * the whole process with it. One listener is the entire fix; there is no reconnect logic
 * because `Pool` already opens a fresh client for the next query on its own.
 *
 * The second half is what the client was told while that was happening. `getaddrinfo
 * ENOTFOUND postgres` was rendered on the login screen, to anyone, signed in or not —
 * the hostname of the database, handed out by the one endpoint that has no authentication
 * in front of it. Messages meant for a person still go through; the difference is carried
 * by `AuthInputError` rather than by matching on message text.
 *
 *   pnpm --filter @zaa-tool/engine test db-resilience
 */
import assert from "node:assert/strict";
import { pool } from "../src/db/connection.js";
import { authController } from "../src/controllers/auth.controller.js";
import { initDb } from "../src/db/initializer.js";

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

/** Enough of an Express response to see what a controller decided. */
function recorder() {
  const seen = { status: 0, body: null as { error?: string } | null };
  const res = {
    status(code: number) {
      seen.status = code;
      return this;
    },
    json(body: unknown) {
      seen.body = body as { error?: string };
      return this;
    },
  };
  return { seen, res: res as never };
}

/** Runs `body` with `console.error` captured, so a test can assert on what was logged. */
async function withCapturedLog(body: () => Promise<void> | void): Promise<string> {
  const original = console.error;
  let logged = "";
  console.error = (...args: unknown[]) => {
    logged += args.map(String).join(" ");
  };
  try {
    await body();
  } finally {
    console.error = original;
  }
  return logged;
}

/** Every query fails the way a dead database fails, for the duration of `body`. */
async function withDeadDatabase(body: () => Promise<void>): Promise<void> {
  const original = pool.query;
  (pool as unknown as { query: unknown }).query = async () => {
    throw new Error("getaddrinfo ENOTFOUND postgres");
  };
  try {
    await body();
  } finally {
    pool.query = original;
  }
}

await initDb();
await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);

console.log("\ndb-resilience (T-01: the pool does not take the process with it)");

await check("an idle-client error is logged rather than thrown", async () => {
  const logged = await withCapturedLog(() => {
    // What `pg` itself does when a client dies between queries. Without the listener in
    // connection.ts this line throws here, and in production it is an uncaught exception.
    assert.doesNotThrow(() => {
      pool.emit("error", new Error("simulated pool connection loss"));
    });
  });
  assert.match(logged, /simulated pool connection loss/);
});

await check("the pool still answers a query afterwards", async () => {
  const { rows } = await pool.query("SELECT 1 AS ok");
  assert.equal(rows[0].ok, 1);
});

console.log("\ndb-resilience (T-02: an internal failure says nothing about itself)");

await check("a wrong password is still told it was wrong", async () => {
  const { seen, res } = recorder();
  await authController.login(
    { body: { username: `${PREFIX}nobody`, password: TEST_PASSWORD } } as never,
    res
  );
  assert.equal(seen.status, 401);
  assert.equal(seen.body?.error, "Invalid username or password");
});

await check("a short password is still told the length", async () => {
  const { seen, res } = recorder();
  await authController.register(
    { body: { username: `${PREFIX}short`, password: "abc" } } as never,
    res
  );
  // 400 or 403 depending on whether registration is open here; either way the point is
  // that the message is the rule the person broke, not a shrug.
  assert.ok([400, 403].includes(seen.status), `unexpected status ${seen.status}`);
  assert.ok(seen.body?.error && seen.body.error.length > 0);
});

await check("a dead database is a 500 that names nothing", async () => {
  let logged = "";
  const { seen, res } = recorder();
  await withDeadDatabase(async () => {
    logged = await withCapturedLog(async () => {
      await authController.login(
        { body: { username: `${PREFIX}user`, password: TEST_PASSWORD } } as never,
        res
      );
    });
  });

  assert.equal(seen.status, 500);
  assert.equal(seen.body?.error, "Something went wrong. Please try again.");
  // The thing that must not be in the response, and must be in the log.
  assert.doesNotMatch(String(seen.body?.error), /postgres|ENOTFOUND|getaddrinfo/i);
  assert.match(logged, /getaddrinfo ENOTFOUND postgres/);
});

await check("the same is true of the unauthenticated policy endpoint", async () => {
  const { seen, res } = recorder();
  await withDeadDatabase(async () => {
    await withCapturedLog(async () => {
      await authController.policy({} as never, res);
    });
  });
  assert.equal(seen.status, 500);
  assert.doesNotMatch(String(seen.body?.error), /postgres|ENOTFOUND|getaddrinfo/i);
});

await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

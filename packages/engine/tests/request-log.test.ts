/**
 * The request log line, the final error handler, and what a 500 is allowed to say.
 *
 * A webhook slug and a share token are bearer credentials that travel in the path, so the
 * `http.request` line masks them; and an error nobody handled must come back as JSON with
 * a request id, not as the HTML page Express writes by default, and not with a driver message.
 *
 *   pnpm --filter @zaa-tool/engine test request-log
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { createApp } from "../src/server/app.js";
import { requestContext, setActor } from "../src/core/request-context.js";
import { requestLog, finalErrorHandler } from "../src/middleware/request-log.middleware.js";
import { maskUrl } from "../src/core/http-errors.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";

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

/** Runs `body` while the log's stdout and stderr are captured; returns the parsed JSON lines. */
async function withLog(body: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const out = process.stdout.write;
  const err = process.stderr.write;
  const lines: string[] = [];
  const grab = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = grab;
  process.stderr.write = grab;
  try {
    await body();
    // `finish` fires just after the client has the body.
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return lines.flatMap((chunk) =>
    chunk
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>)
  );
}

async function serve(app: express.Express, run: (base: string) => Promise<void>): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

await initDb();

console.log("\nmasking");

await check("credential path segments and query parameters are masked", () => {
  assert.equal(maskUrl("/hooks/s3cr3t-slug"), "/hooks/[slug]");
  assert.equal(maskUrl("/api/shared/tok-123/run"), "/api/shared/[token]/run");
  assert.equal(maskUrl("/a/tok-123"), "/a/[token]");
  assert.equal(maskUrl("/storage/x.png?exp=1&sig=abc"), "/storage/x.png?exp=1");
  assert.equal(maskUrl("/api/x?token=abc&limit=5"), "/api/x?limit=5");
  assert.equal(maskUrl("/api/notebooks?limit=5"), "/api/notebooks?limit=5");
});

console.log("\nhttp.request line");

await check("one line per request, with the slug masked, and request id, status and duration", async () => {
  const lines = await withLog(async () => {
    await serve(createApp(() => {}), async (base) => {
      const res = await fetch(`${base}/hooks/zz-ops-secret-slug-aaaa?sig=zzzsig&x=1`, { method: "POST" });
      assert.equal(res.status, 404);
    });
  });
  const mine = lines.filter((l) => l.event === "http.request");
  assert.equal(mine.length, 1);
  const line = mine[0];
  assert.equal(line.method, "POST");
  assert.equal(line.path, "/hooks/[slug]?x=1");
  assert.equal(line.status, 404);
  assert.equal(typeof line.duration_ms, "number");
  assert.ok(String(line.request_id).length >= 8);
  const everything = JSON.stringify(lines);
  assert.ok(!everything.includes("zz-ops-secret-slug-aaaa"), "the slug reached the log");
  assert.ok(!everything.includes("zzzsig"), "the sig reached the log");
});

await check("the actor set by a guard is the one on the line, not the anonymous start", async () => {
  const app = express();
  app.use(requestContext);
  app.use(requestLog);
  app.get("/who", (_req, res) => {
    setActor({ type: "system", component: "guard-test" });
    res.json({ ok: true });
  });
  const lines = await withLog(() => serve(app, async (base) => void (await fetch(`${base}/who`))));
  const line = lines.find((l) => l.event === "http.request");
  assert.ok(line);
  assert.equal(line["actor.type"], "system");
});

await check("/api/health is not an info line", async () => {
  const lines = await withLog(() =>
    serve(createApp(() => {}), async (base) => void (await fetch(`${base}/api/health`)))
  );
  assert.equal(lines.filter((l) => l.event === "http.request").length, 0);
});

console.log("\nfinal error handler");

await check("an unhandled error is a JSON 500 with the request id, no stack, no message", async () => {
  const app = express();
  app.use(requestContext);
  app.use(requestLog);
  app.get("/boom", () => {
    throw new Error('relation "secret_table" does not exist at /srv/app/db.ts');
  });
  app.use(finalErrorHandler);
  let body = "";
  let header = "";
  let type = "";
  const lines = await withLog(() =>
    serve(app, async (base) => {
      const res = await fetch(`${base}/boom`);
      assert.equal(res.status, 500);
      type = res.headers.get("content-type") ?? "";
      header = res.headers.get("x-request-id") ?? "";
      body = await res.text();
    })
  );
  assert.match(type, /application\/json/);
  const parsed = JSON.parse(body) as { error: string; requestId: string };
  assert.equal(parsed.error, "Something went wrong. Please try again.");
  assert.equal(parsed.requestId, header);
  assert.ok(!/secret_table|\/srv\/app|\bat \w|stack/i.test(body), `the body names the failure: ${body}`);
  const logged = lines.find((l) => l.event === "http.unhandled_error");
  assert.ok(logged, "the error was not logged");
  assert.equal(logged.request_id, header);
  assert.match(JSON.stringify(logged), /secret_table/, "the real cause belongs in the log");
});

await check("a body that is too large or not JSON is a short 4xx, never a stack", async () => {
  await serve(createApp(() => {}), async (base) => {
    const big = await fetch(`${base}/hooks/zz-ops-x`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024) }),
    });
    assert.equal(big.status, 413);
    const bigBody = (await big.json()) as { error: string; requestId: string };
    assert.ok(bigBody.requestId);

    const bad = await fetch(`${base}/hooks/zz-ops-x`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a": nope',
    });
    assert.equal(bad.status, 400);
    const text = await bad.text();
    assert.ok(!/nope|SyntaxError|<pre>/.test(text), `the parser message leaked: ${text}`);
  });
});

await check("an unknown route is a JSON 404, not the default HTML page", async () => {
  await serve(createApp(() => {}), async (base) => {
    const res = await fetch(`${base}/no-such-thing`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  });
});

console.log("\ncatch-all 500 paths");

await check("a hook the database cannot encode answers the generic body, not the pg message", async () => {
  // `%00` decodes to a NUL byte, which postgres refuses as a query parameter; that message
  // used to be sent to the caller verbatim.
  await serve(createApp(() => {}), async (base) => {
    const res = await fetch(`${base}/hooks/%00`, { method: "POST" });
    assert.ok(res.status === 404 || res.status === 500, `unexpected status ${res.status}`);
    const text = await res.text();
    assert.ok(!/invalid byte|UTF8|0x00|encoding/i.test(text), `driver message leaked: ${text}`);
    if (res.status === 500) {
      const body = JSON.parse(text) as { error: string; requestId: string };
      assert.equal(body.error, "Something went wrong. Please try again.");
      assert.ok(body.requestId);
    }
  });
});

await check("a share link the database cannot encode answers the generic body", async () => {
  await serve(createApp(() => {}), async (base) => {
    const res = await fetch(`${base}/api/shared/%00`);
    const text = await res.text();
    assert.ok(!/invalid byte|UTF8|0x00|encoding/i.test(text), `driver message leaked: ${text}`);
  });
});

await pool.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

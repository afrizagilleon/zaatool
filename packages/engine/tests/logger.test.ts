/**
 * The operational logger: what it writes, and what it must never write.
 *
 *   pnpm --filter @zaa-tool/engine test logger
 */
import assert from "node:assert/strict";
import { logger } from "../src/core/logger.js";
import { withContext } from "../src/core/request-context.js";

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

/** Everything the logger wrote to stdout and stderr while `body` ran, as raw lines. */
function capture(body: () => void): string[] {
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
    body();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return lines;
}

const parse = (lines: string[]) => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

console.log("\nlogger");

await check("a line is JSON with ts, level, service, event and msg", () => {
  const [line] = parse(capture(() => logger.info("Hello.", { event: "test.hello", count: 3 })));
  assert.equal(line.level, "info");
  assert.equal(line.service, "zaatool-engine");
  assert.equal(line.event, "test.hello");
  assert.equal(line.msg, "Hello.");
  assert.equal(line.count, 3);
  assert.ok(!Number.isNaN(Date.parse(String(line.ts))));
});

await check("credential-named keys are redacted at any depth, case-insensitively", () => {
  const [line] = parse(
    capture(() =>
      logger.info("x", {
        event: "test.redact",
        password: "hunter2",
        nested: { Authorization: "Bearer abc", deeper: [{ apiKey: "k-123", cookie: "c=1" }], fine: "visible" },
        slug: "the-webhook-slug",
        setup_code: "123456",
      })
    )
  );
  const text = JSON.stringify(line);
  for (const leaked of ["hunter2", "Bearer abc", "k-123", "c=1", "the-webhook-slug", "123456"]) {
    assert.ok(!text.includes(leaked), `${leaked} was written`);
  }
  assert.equal((line.nested as { fine: string }).fine, "visible");
});

await check("identifier keys that merely contain a credential word are kept", () => {
  const [line] = parse(
    capture(() => logger.info("x", { event: "test.ids", tokenId: "t-1", share_id: "s-1", trigger_id: "g-1", secretId: "x-1" }))
  );
  assert.equal(line.tokenId, "t-1");
  assert.equal(line.share_id, "s-1");
  assert.equal(line.trigger_id, "g-1");
  assert.equal(line.secretId, "x-1");
});

await check("a database error's detail and parameters are dropped, its code and constraint kept", () => {
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_pkey"'), {
    code: "23505",
    constraint: "users_pkey",
    table: "users",
    detail: "Key (username)=(alice-secret-name) already exists.",
    where: "COPY row (hunter2)",
    parameters: ["hunter2"],
  });
  const [line] = parse(capture(() => logger.error("failed", { event: "test.pg", err: pgError })));
  const text = JSON.stringify(line);
  assert.ok(!text.includes("alice-secret-name"), "detail leaked");
  assert.ok(!text.includes("hunter2"), "where/parameters leaked");
  const error = line.error as Record<string, unknown>;
  assert.equal(error.code, "23505");
  assert.equal(error.constraint, "users_pkey");
});

await check("a newline or terminal escape in a value cannot forge a second line", () => {
  const hostile = 'ok"}\n{"ts":"x","level":"error","event":"forged"}\u001b[31m';
  const lines = capture(() => logger.info("name given", { event: "test.inject", notebook_name: hostile }));
  assert.equal(lines.length, 1);
  const raw = lines[0];
  assert.equal(raw.split("\n").filter(Boolean).length, 1, "the record spans more than one line");
  assert.ok(!raw.includes("\u001b"), "a raw escape byte was written");
  const [line] = parse(lines);
  assert.equal(line.notebook_name, hostile, "the value round-trips unchanged");
  assert.equal(line.event, "test.inject");
});

await check("the pretty format is injection-proof too", () => {
  process.env.LOG_FORMAT = "pretty";
  try {
    const lines = capture(() => logger.info("a\nforged line", { event: "test.pretty", x: "b\nc" }));
    assert.equal(lines.join("").split("\n").filter(Boolean).length, 1);
  } finally {
    delete process.env.LOG_FORMAT;
  }
});

await check("LOG_LEVEL filters what is written", () => {
  const original = process.env.LOG_LEVEL;
  try {
    process.env.LOG_LEVEL = "warn";
    const lines = capture(() => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
    });
    assert.deepEqual(parse(lines).map((l) => l.level), ["warn", "error"]);
    process.env.LOG_LEVEL = "debug";
    assert.equal(capture(() => logger.debug("d")).length, 1);
  } finally {
    if (original === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = original;
  }
});

await check("request id and actor come from the context the line is written in", () => {
  const [line] = parse(
    capture(() =>
      withContext({ requestId: "req-12345678", actor: { type: "system", component: "test" } }, () =>
        logger.info("x", { event: "test.context" })
      )
    )
  );
  assert.equal(line.request_id, "req-12345678");
  assert.equal(line["actor.type"] ?? (line.actor as { type?: string } | undefined)?.type, "system");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

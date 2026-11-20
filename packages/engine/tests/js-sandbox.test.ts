import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runJsNode } from "../src/core/js-runner.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";

/**
 * K-02: a JS cell runs in its own node process under the permission model.
 *
 * Every "blocked" case below is something a cell could do while cells ran in a worker
 * thread inside the engine: read the engine's source, read any file, write any file,
 * start a process. Each must now end the cell with an access error — and the engine, which
 * is this very process, must still be standing at the end of the file.
 *
 * Test data is prefixed `zz-k02-`, removed before and after.
 */
const PREFIX = "zz-k02-";
const here = path.dirname(fileURLToPath(import.meta.url));
const engineConfig = path.resolve(here, "../src/config.ts");
const uploads = path.join(STORAGE_DIR, "uploads", `${PREFIX}nb`);
const tmpFile = path.join(os.tmpdir(), `${PREFIX}secret.txt`);
const writeTarget = path.join(os.tmpdir(), `${PREFIX}written.txt`);

function sweep(): void {
  fs.rmSync(uploads, { recursive: true, force: true });
  fs.rmSync(tmpFile, { force: true });
  fs.rmSync(writeTarget, { force: true });
}
sweep();
fs.mkdirSync(uploads, { recursive: true });
fs.writeFileSync(path.join(uploads, "doc.txt"), "hello from storage");
fs.writeFileSync(tmpFile, "not for cells");

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

const DENIED = /ERR_ACCESS_DENIED|Access to this API has been restricted|not available in a notebook cell/i;

async function blocked(code: string, inputs: Record<string, unknown> = {}): Promise<void> {
  const res = await runJsNode(code, inputs, 20000);
  assert.ok(res.error, `expected the cell to fail, but it returned ${JSON.stringify(res.output)}`);
  assert.match(res.error!, DENIED);
}

console.log("\njs-sandbox (K-02: permission model)");

await check("require('module')._load('child_process') is denied", () =>
  blocked("return require('module')._load('child_process').spawnSync(process.execPath, ['-v']).status;"));

await check("require('child_process') is denied", () =>
  blocked("return require('child_process').spawnSync(process.execPath, ['-v']).status;"));

await check("fs.readFileSync of the engine's own source is denied", () =>
  blocked("return require('fs').readFileSync(inputs.p, 'utf8').length;", { p: engineConfig }));

await check("fs.readFileSync of a file in the temp dir is denied", () =>
  blocked("return require('fs').readFileSync(inputs.p, 'utf8');", { p: tmpFile }));

await check("fs.writeFileSync is denied", async () => {
  await blocked("require('fs').writeFileSync(inputs.p, 'x'); return true;", { p: writeTarget });
  assert.equal(fs.existsSync(writeTarget), false);
});

await check("a worker thread cannot be started, even loaded around the require list", () =>
  blocked(
    "const { Worker } = require('module')._load('worker_threads');" +
      " await new Promise((res, rej) => { const w = new Worker('process.exit(0)', { eval: true }); w.on('exit', res); w.on('error', rej); });" +
      " return true;"
  ));

await check("the same, through the require list, fails with a readable message", () =>
  blocked("require('worker_threads'); return true;"));

await check("process.env shows only allow-listed variables and declared secrets", async () => {
  const before = { pw: process.env.POSTGRES_PASSWORD, jwt: process.env.JWT_SECRET };
  process.env.POSTGRES_PASSWORD = "zz-k02-db-password";
  process.env.JWT_SECRET = "zz-k02-jwt-secret-zz-k02-jwt-secret";
  try {
    const res = await runJsNode(
      "return { keys: Object.keys(process.env), all: JSON.stringify(process.env) };",
      {},
      20000,
      undefined,
      { MY_SECRET: "zz-k02-declared" }
    );
    assert.equal(res.error, undefined);
    const out = res.output as unknown as { keys: string[]; all: string };
    assert.ok(out.keys.includes("MY_SECRET"));
    assert.ok(!out.keys.includes("POSTGRES_PASSWORD"));
    assert.ok(!out.keys.includes("JWT_SECRET"));
    assert.ok(!out.all.includes("zz-k02-db-password"));
    assert.ok(!out.all.includes("zz-k02-jwt-secret"));
  } finally {
    if (before.pw === undefined) delete process.env.POSTGRES_PASSWORD;
    else process.env.POSTGRES_PASSWORD = before.pw;
    if (before.jwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = before.jwt;
  }
});

await check("allocating far beyond the memory cap fails the cell", async () => {
  const old = process.env.MAX_CELL_MEMORY_MB;
  process.env.MAX_CELL_MEMORY_MB = "64";
  try {
    const res = await runJsNode(
      "const keep = []; for (let i = 0; i < 80; i++) keep.push(Array.from({ length: 1e6 }, (_, j) => ({ j })));" +
        " return keep.length;",
      {},
      60000
    );
    assert.ok(res.error, `expected failure, got ${JSON.stringify(res.output)}`);
  } finally {
    if (old === undefined) delete process.env.MAX_CELL_MEMORY_MB;
    else process.env.MAX_CELL_MEMORY_MB = old;
  }
});

console.log("\njs-sandbox (legitimate cells still work)");

await check("a file input inside storage is readable", async () => {
  const res = await runJsNode(
    "return inputs.doc.readAsText();",
    { doc: { name: "doc.txt", path: `uploads/${PREFIX}nb/doc.txt` } },
    20000,
    undefined,
    {},
    [{ name: "doc", type: "file" }]
  );
  assert.equal(res.error, undefined);
  assert.equal(res.output, "hello from storage");
});

await check("a file input outside storage reads as empty", async () => {
  const res = await runJsNode(
    "return inputs.doc.readAsText() + '|' + inputs.doc.exists();",
    { doc: { name: "x", path: "../../src/config.ts" } },
    20000,
    undefined,
    {},
    [{ name: "doc", type: "file" }]
  );
  assert.equal(res.error, undefined);
  assert.equal(res.output, "|false");
});

await check("files.write reaches the engine", async () => {
  const writes: unknown[] = [];
  const res = await runJsNode(
    "const r = await files.write('a.txt', 'hi'); return r;",
    {},
    20000,
    undefined,
    {},
    [],
    undefined,
    (async (w: unknown) => {
      writes.push(w);
      return { path: "p/a.txt", url: "u" };
    }) as never
  );
  assert.equal(res.error, undefined);
  assert.deepEqual(res.output, { path: "p/a.txt", url: "u" });
  assert.equal(writes.length, 1);
});

await check("notebooks.run reaches the engine", async () => {
  const res = await runJsNode(
    "const r = await notebooks.run('other', { a: 1 }); return r;",
    {},
    20000,
    undefined,
    {},
    [],
    (async (call: { notebook: string; input: unknown }) => ({
      echoed: call.input,
      nb: call.notebook,
    })) as never
  );
  assert.equal(res.error, undefined);
  assert.deepEqual(res.output, { echoed: { a: 1 }, nb: "other" });
});

await check("a declared package loads", async () => {
  const res = await runJsNode(
    "return require('yaml').parse('a: 1');",
    {},
    20000,
    undefined,
    {},
    [],
    undefined,
    undefined,
    ["yaml"]
  );
  assert.equal(res.error, undefined);
  assert.deepEqual(res.output, { a: 1 });
});

await check("an undeclared package is refused", async () => {
  const res = await runJsNode("return require('yaml');", {}, 20000);
  assert.ok(res.error);
});

await check("a table input: filter and map hand the callback the row, its index and the rows", async () => {
  const rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const res = await runJsNode(
    "return { kept: inputs.t.filter((row, i, all) => i > 0 && all.length === 3).count(), mapped: inputs.t.map((row, i) => row.n * 10 + i) };",
    { t: rows },
    20000,
    undefined,
    {},
    [{ name: "t", type: "table" }]
  );
  assert.equal(res.error, undefined);
  assert.deepEqual(res.output, { kept: 2, mapped: [10, 21, 32] });
});

await check("the engine is still running", () => {
  assert.equal(typeof process.pid, "number");
});

sweep();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * A `file` input is a descriptor from the caller, and nothing in it may choose which
 * file on this machine's disk a cell reads. Covers the args path (contract), the `input`
 * seeding path (reader), for both runtimes.
 *
 * Everything it creates is prefixed `zz-f3-` and removed at the end.
 *
 *   pnpm --filter @zaa-tool/engine test file-input-paths
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { ContractError } from "../src/core/notebook-contract.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
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

await initDb();
// Where cells change uid a notebook needs an owner to run as (FX-17); this test is about files, not owners.
const owner = (await testOwner("f3")).id;

const OUTSIDE_TEXT = "zz-f3-OUTSIDE-SECRET";
const INSIDE_TEXT = "zz-f3-inside-content";
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-f3-"));
const outsideFile = path.join(outsideDir, "outside.txt");
fs.writeFileSync(outsideFile, OUTSIDE_TEXT);

const insideDir = path.join(STORAGE_DIR, "zz-f3-files");
fs.mkdirSync(insideDir, { recursive: true });
fs.writeFileSync(path.join(insideDir, "inside.txt"), INSIDE_TEXT);
const INSIDE_REL = "zz-f3-files/inside.txt";

const created: string[] = [];

async function store(runtime: "node" | "python"): Promise<string> {
  const id = `zz-f3-${runtime}-id`;
  const body =
    runtime === "node"
      ? ["```js", "return { text: inputs.doc ? inputs.doc.readAsText() : 'none' };", "```"]
      : ["```python", "return { 'text': inputs['doc'].read_as_text() if inputs.get('doc') else 'none' }", "```"];
  const saved = await notebooksService.save(
    fromMarkdown(
      [
        "---",
        `name: zz-f3-${runtime}`,
        `id: ${id}`,
        `runtime: ${runtime}`,
        "inputs:",
        "  - name: doc",
        "    type: file",
        "outputs: [text]",
        "---",
        "",
        ...body,
      ].join("\n")
    ),
    "test",
    owner
  );
  await notebooksService.deploy(saved.id, "test");
  created.push(saved.id);
  return saved.id;
}

async function run(id: string, options: { args?: Record<string, unknown>; input?: Record<string, unknown> }) {
  const started = await notebookExecutionService.start(id, () => {}, options);
  return started.completed;
}

try {
  for (const runtime of ["node", "python"] as const) {
    console.log(`\n${runtime}`);
    const id = await store(runtime);

    await check("a) args escaping storage with a hand-made absolute_path is rejected", async () => {
      await assert.rejects(
        () => run(id, { args: { doc: { path: "../x", absolute_path: outsideFile } } }),
        (err: unknown) => err instanceof ContractError
      );
    });

    await check("b) a valid inside path plus a hostile absolute_path reads the inside file", async () => {
      const result = await run(id, { args: { doc: { path: INSIDE_REL, absolute_path: outsideFile } } });
      assert.equal(result.status, "success", result.errors[0]);
      assert.equal(result.outputs.text, INSIDE_TEXT);
    });

    await check("c) `input` seeding with a hostile descriptor never reads the outside file", async () => {
      const result = await run(id, { input: { doc: { path: "../x", absolute_path: outsideFile } } });
      assert.notEqual(result.outputs.text, OUTSIDE_TEXT, "read a file outside storage");
      assert.ok(!JSON.stringify(result).includes(OUTSIDE_TEXT));

      const direct = await run(id, { input: { doc: { path: INSIDE_REL, absolute_path: outsideFile } } });
      assert.notEqual(direct.outputs.text, OUTSIDE_TEXT, "read a file outside storage");
    });

    await check("d) a normal valid path still reads", async () => {
      const result = await run(id, { args: { doc: INSIDE_REL } });
      assert.equal(result.status, "success", result.errors[0]);
      assert.equal(result.outputs.text, INSIDE_TEXT);
    });
  }
} finally {
  for (const id of created) await notebooksService.delete(id).catch(() => {});
  fs.rmSync(insideDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
  await dropOwner("f3");
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

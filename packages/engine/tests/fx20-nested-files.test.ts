/**
 * FX-20 D-7: a file a notebook hands back through `notebooks.run` is copied into the
 * caller's cell folder before the caller hears back, so the caller can read it even though
 * it cannot read storage. A path that nobody in the chain was granted is not copied, and a
 * file one cell wrote is readable by the next cell of the same run.
 *
 * Everything it creates is prefixed `zz-fx20n-` and removed at the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx20-nested-files
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookJson } from "@zaa-tool/shared";
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
await dropOwner("fx20n-a");
await dropOwner("fx20n-b");

const created: string[] = [];
const folders: string[] = [];

async function store(
  owner: string,
  runtime: "node" | "python",
  name: string,
  steps: { id: string; code: string }[],
  outputs: string[]
): Promise<string> {
  const document = {
    version: "1.0",
    id: name,
    name,
    runtime,
    outputs,
    steps: steps.map((step) => ({ id: step.id, kind: "cell", code: step.code })),
  } as unknown as NotebookJson;
  const saved = await notebooksService.save(document, "test", owner);
  await notebooksService.deploy(saved.id, "test");
  await pool.query("UPDATE notebooks SET app_visibility = 'all' WHERE id = $1", [saved.id]);
  created.push(saved.id);
  return saved.id;
}

async function run(id: string, startedBy: string) {
  const started = await notebookExecutionService.start(id, () => {}, { startedBy });
  return started.completed;
}

try {
  const a = await testOwner("fx20n-a");
  const b = await testOwner("fx20n-b");

  const writer = {
    node: `const f = await files.write("zz-note.txt", "zz-fx20n-FROM-B"); return { file: f };`,
    python: `f = files.write("zz-note.txt", "zz-fx20n-FROM-B")\nreturn {'file': f}`,
  };
  const reader = (callee: string) => ({
    node: `const r = await notebooks.run(${JSON.stringify(callee)}, {});
           const file = new FileObject(r.file);
           return { text: file.readAsText(), exists: file.exists() };`,
    python: `r = notebooks.run(${JSON.stringify(callee)}, {})
f = FileObject(r['file'])
return {'text': f.read_as_text(), 'exists': f.exists()}`,
  });

  for (const calleeRuntime of ["node", "python"] as const) {
    for (const callerRuntime of ["node", "python"] as const) {
      const label = `${callerRuntime} caller of a ${calleeRuntime} callee`;
      const calleeName = `zz-fx20n-writer-${calleeRuntime}-${callerRuntime}`;

      await check(`${label}: the file the callee wrote is readable by the caller`, async () => {
        await store(b.id, calleeRuntime, calleeName, [{ id: "w", code: writer[calleeRuntime] }], ["file"]);
        const caller = await store(
          a.id,
          callerRuntime,
          `zz-fx20n-reader-${callerRuntime}-${calleeRuntime}`,
          [{ id: "r", code: reader(calleeName)[callerRuntime] }],
          ["text", "exists"]
        );
        const result = await run(caller, a.id);
        assert.equal(result.status, "success", result.errors[0]);
        assert.equal(result.outputs.text, "zz-fx20n-FROM-B");
        assert.equal(result.outputs.exists, true);
        folders.push(`notebooks/${calleeName}`);
      });
    }
  }

  await check("a path the callee returns that nobody in the chain was granted is not copied", async () => {
    const victim = await store(b.id, "node", "zz-fx20n-victim", [{ id: "v", code: "return { ok: true };" }], ["ok"]);
    const folder = path.join(STORAGE_DIR, "notebooks", victim);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "private.txt"), "zz-fx20n-PRIVATE");
    folders.push(`notebooks/${victim}`);

    await store(
      b.id,
      "node",
      "zz-fx20n-liar",
      [{ id: "l", code: `return { file: { name: "private.txt", path: ${JSON.stringify(`notebooks/${victim}/private.txt`)} } };` }],
      ["file"]
    );
    const caller = await store(a.id, "node", "zz-fx20n-asks-liar", [{ id: "r", code: reader("zz-fx20n-liar").node }], ["text", "exists"]);
    const result = await run(caller, a.id);
    assert.equal(result.status, "success", result.errors[0]);
    assert.equal(result.outputs.text, "");
    assert.equal(result.outputs.exists, false);
  });

  await check("a cell that fabricates a descriptor for another notebook's file reads nothing", async () => {
    const other = await store(b.id, "node", "zz-fx20n-other", [{ id: "o", code: "return { ok: true };" }], ["ok"]);
    const folder = path.join(STORAGE_DIR, "notebooks", other);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "mine-not.txt"), "zz-fx20n-NOT-YOURS");
    folders.push(`notebooks/${other}`);

    const code = `const f = new FileObject({ name: "x", path: ${JSON.stringify(`notebooks/${other}/mine-not.txt`)} });
                  return { text: f.readAsText(), exists: f.exists() };`;
    const id = await store(a.id, "node", "zz-fx20n-forger", [{ id: "f", code }], ["text", "exists"]);
    const result = await run(id, a.id);
    assert.equal(result.status, "success", result.errors[0]);
    assert.equal(result.outputs.text, "");
    assert.equal(result.outputs.exists, false);
  });

  for (const runtime of ["node", "python"] as const) {
    await check(`${runtime}: a file one cell wrote is readable by the next cell of the same run`, async () => {
      const first =
        runtime === "node"
          ? `const made = await files.write("zz-chart.txt", "zz-fx20n-CHART"); return { made };`
          : `made = files.write("zz-chart.txt", "zz-fx20n-CHART")\nreturn {'made': made}`;
      const second =
        runtime === "node"
          ? `return { text: new FileObject(inputs.made).readAsText() };`
          : `return {'text': FileObject(inputs['made']).read_as_text()}`;
      const id = await store(
        a.id,
        runtime,
        `zz-fx20n-two-cells-${runtime}`,
        [
          { id: "c1", code: first },
          { id: "c2", code: second },
        ],
        ["text"]
      );
      const result = await run(id, a.id);
      assert.equal(result.status, "success", result.errors[0]);
      assert.equal(result.outputs.text, "zz-fx20n-CHART");
      folders.push(`notebooks/zz-fx20n-two-cells-${runtime}`);
    });
  }
} finally {
  for (const id of created) await notebooksService.delete(id).catch(() => {});
  for (const folder of new Set(folders)) fs.rmSync(path.join(STORAGE_DIR, folder), { recursive: true, force: true });
  await dropOwner("fx20n-a");
  await dropOwner("fx20n-b");
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * FX-20 D-5: a cell reads a file input from a copy the engine put in the cell's own folder,
 * never from storage. Only granted files are copied; a path in `input` that nobody admitted
 * reads as empty. Same for JavaScript and Python.
 *
 * Everything it creates is prefixed `zz-fx20s-` and removed at the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx20-staging
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCellHost, type WorkspaceFs } from "../src/core/cell-workspace.js";
import { runJsNode } from "../src/core/js-runner.js";
import { runPythonNode } from "../src/core/python-runner.js";
import type { SandboxConfig } from "../src/core/sandbox-identity.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { fromMarkdown } from "../src/core/notebook-text.js";
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
await dropOwner("fx20s-a");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zz-fx20s-"));
const dirInStorage = path.join(STORAGE_DIR, "zz-fx20s-files");
fs.mkdirSync(dirInStorage, { recursive: true });
fs.writeFileSync(path.join(dirInStorage, "a.txt"), "zz-fx20s-A");
fs.mkdirSync(path.join(dirInStorage, "sub"), { recursive: true });
fs.writeFileSync(path.join(dirInStorage, "sub", "a.txt"), "zz-fx20s-SUB-A");
const A = "zz-fx20s-files/a.txt";
const SUB_A = "zz-fx20s-files/sub/a.txt";
const created: string[] = [];

const schema = [{ name: "doc", type: "file" }];
const jsRead = "return { text: inputs.doc.readAsText(), exists: inputs.doc.exists(), abs: inputs.doc.absolute_path };";
const pyRead =
  "return { 'text': inputs['doc'].read_as_text(), 'exists': inputs['doc'].exists(), 'abs': inputs['doc'].absolute_path }";

type Out = { text: string; exists: boolean; abs: string };
async function viaRunner(runtime: "node" | "python", host: ReturnType<typeof createCellHost>, doc: unknown): Promise<Out> {
  const run = runtime === "node" ? runJsNode : runPythonNode;
  const res = await run(runtime === "node" ? jsRead : pyRead, { doc }, 30000, undefined, {}, schema, undefined, undefined, [], undefined, host);
  assert.equal(res.error, undefined, res.error);
  return res.output as unknown as Out;
}

try {
  for (const runtime of ["node", "python"] as const) {
    console.log(`\n${runtime}`);

    await check("a granted file is read from a copy inside the cell's own folder, not from storage", async () => {
      const host = createCellHost({ tempRoot, ownerKey: "o1", grants: new Set([A]) });
      const out = await viaRunner(runtime, host, { name: "a.txt", path: A });
      assert.equal(out.text, "zz-fx20s-A");
      assert.equal(out.exists, true);
      assert.ok(path.resolve(out.abs).startsWith(path.resolve(tempRoot) + path.sep), `read from ${out.abs}`);
      assert.ok(!path.resolve(out.abs).startsWith(path.resolve(STORAGE_DIR)), "the cell was pointed into storage");
    });

    await check("a file that exists in storage but was not granted reads as empty", async () => {
      const host = createCellHost({ tempRoot, ownerKey: "o1", grants: new Set() });
      const out = await viaRunner(runtime, host, { name: "a.txt", path: A });
      assert.equal(out.text, "");
      assert.equal(out.exists, false);
    });

    await check("a hostile absolute_path in the data never becomes the file read", async () => {
      const host = createCellHost({ tempRoot, ownerKey: "o1", grants: new Set([A]) });
      const out = await viaRunner(runtime, host, {
        name: "a.txt",
        path: A,
        absolute_path: path.join(dirInStorage, "sub", "a.txt"),
      });
      assert.equal(out.text, "zz-fx20s-A");
    });

    await check("two granted files with the same name get two copies", async () => {
      const host = createCellHost({ tempRoot, ownerKey: "o1", grants: new Set([A, SUB_A]) });
      const ws = host.open({ one: { path: A }, two: [{ path: SUB_A }] });
      try {
        const copies = Object.values(ws.staged);
        assert.equal(copies.length, 2);
        assert.notEqual(copies[0], copies[1]);
        assert.deepEqual(copies.map((copy) => fs.readFileSync(copy, "utf8")).sort(), ["zz-fx20s-A", "zz-fx20s-SUB-A"]);
      } finally {
        ws.dispose();
      }
    });

    await check("the copy is removed with the folder, and storage is untouched", async () => {
      const host = createCellHost({ tempRoot, ownerKey: "o2", grants: new Set([A]) });
      const ws = host.open({ path: A });
      const [copy] = Object.values(ws.staged);
      assert.ok(fs.existsSync(copy));
      ws.dispose();
      assert.ok(!fs.existsSync(copy));
      assert.equal(fs.readFileSync(path.join(dirInStorage, "a.txt"), "utf8"), "zz-fx20s-A");
    });
  }

  console.log("\ncopies are the cell's own");
  await check("a Python cell that overwrites its copy does not change storage", async () => {
    const host = createCellHost({ tempRoot, ownerKey: "o3", grants: new Set([A]) });
    const res = await runPythonNode(
      "open(inputs['doc'].absolute_path, 'w').write('changed')\nreturn {'text': inputs['doc'].read_as_text()}",
      { doc: { path: A } },
      30000,
      undefined,
      {},
      schema,
      undefined,
      undefined,
      [],
      undefined,
      host
    );
    assert.equal(res.error, undefined, res.error);
    assert.equal((res.output as { text: string }).text, "changed");
    assert.equal(fs.readFileSync(path.join(dirInStorage, "a.txt"), "utf8"), "zz-fx20s-A");
  });

  console.log("\nsandbox mode (recorded): the copy is the owner's and 0600");
  await check("a staged file and its folder are chowned to the owner's uid and closed to everyone else", () => {
    const config: SandboxConfig = { uidBase: 20000, uidCount: 40000, gid: 10001, home: "/home/sandbox" };
    const calls: string[] = [];
    const recording: WorkspaceFs = {
      mkdirSync: () => undefined,
      chmodSync: (target, mode) => void calls.push(`chmod ${mode.toString(8)} ${target}`),
      chownSync: (target, uid, gid) => void calls.push(`chown ${uid}:${gid} ${target}`),
      rmSync: () => undefined,
      copyFileSync: (source, target) => void calls.push(`copy ${path.basename(source)} -> ${target}`),
      statSync: (target) => fs.statSync(target),
    };
    const ws = createCellHost({ sandbox: { config, uid: 20005 }, fs: recording, grants: new Set([A]) }).open({ path: A });
    const copy = /-> (.+)$/.exec(calls.find((call) => call.startsWith("copy"))!)![1];
    assert.match(copy, /^\/home\/sandbox\/owners\/20005\/cells\/[0-9a-f]{32}\/files\/1-a\.txt$/);
    assert.ok(calls.includes(`chown 20005:10001 ${copy}`));
    assert.ok(calls.includes(`chmod 600 ${copy}`));
    assert.ok(calls.includes(`chown 20005:10001 ${path.posix.dirname(copy)}`));
    assert.ok(calls.includes(`chmod 700 ${path.posix.dirname(copy)}`));
    ws.dispose();
  });

  console.log("\nthrough the engine: `input` seeding cannot make the engine copy a file nobody admitted");
  await check("a hostile descriptor seeded as `input` reads empty, for both runtimes", async () => {
    const a = await testOwner("fx20s-a");
    for (const runtime of ["node", "python"] as const) {
      const body =
        runtime === "node"
          ? ["```js", "return { text: inputs.doc ? inputs.doc.readAsText() : 'none' };", "```"]
          : ["```python", "return { 'text': inputs['doc'].read_as_text() if inputs.get('doc') else 'none' }", "```"];
      const saved = await notebooksService.save(
        fromMarkdown(
          [
            "---",
            `name: zz-fx20s-${runtime}`,
            `id: zz-fx20s-${runtime}`,
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
        a.id
      );
      await notebooksService.deploy(saved.id, "test");
      created.push(saved.id);
      const secretDir = path.join(STORAGE_DIR, "notebooks", `zz-fx20s-other-${runtime}`);
      fs.mkdirSync(secretDir, { recursive: true });
      fs.writeFileSync(path.join(secretDir, "secret.txt"), "zz-fx20s-OTHERS-SECRET");
      try {
        const started = await notebookExecutionService.start(saved.id, () => {}, {
          input: { doc: { name: "secret.txt", path: `notebooks/zz-fx20s-other-${runtime}/secret.txt` } },
          startedBy: a.id,
        });
        const result = await started.completed;
        assert.equal(result.status, "success", result.errors[0]);
        assert.equal(result.outputs.text, "", `${runtime} read a file nobody admitted`);
      } finally {
        fs.rmSync(secretDir, { recursive: true, force: true });
      }
    }
  });
} finally {
  for (const id of created) await notebooksService.delete(id).catch(() => {});
  fs.rmSync(dirInStorage, { recursive: true, force: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
  await dropOwner("fx20s-a");
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

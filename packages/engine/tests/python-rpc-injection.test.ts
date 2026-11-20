/**
 * Python protocol injection.
 *
 * The Python child speaks to the engine in framed lines on stdout (`file:write`, `call`,
 * `done`, `error`), and user code prints to the same stdout. With a fixed frame prefix,
 * a cell that printed external data (a webhook body) let that data write files, run other
 * notebooks and forge the run's result. Frames now carry a per-run secret marker that
 * only the engine and the wrapper know, so printed data is only ever a log line.
 *
 * Notebooks it creates are prefixed `zz-k05-` and removed at the end.
 *
 *   pnpm --filter @zaa-tool/engine test python-rpc-injection
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { notebookFilesService } from "../src/services/notebook-files.service.js";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { testOwner, dropOwner } from "./owners.js";

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
const OWNER = (await testOwner("pythonrpcinjection")).id;

const created: string[] = [];

async function store(text: string): Promise<string> {
  const saved = await notebooksService.save(fromMarkdown(text), "test", OWNER);
  await notebooksService.deploy(saved.id, "test");
  created.push(saved.id);
  return saved.id;
}

/** A python notebook of one cell; `msg` is a string input the cell may print. */
function pythonNotebook(slug: string, code: string[], packages: string[] = [], outputs = "ok"): string {
  return [
    "---",
    `name: zz-k05-${slug}`,
    `id: zz-k05-${slug}-id`,
    "runtime: python",
    ...(packages.length ? [`packages: [${packages.join(", ")}]`] : []),
    "inputs:",
    "  - name: msg",
    "    type: string",
    '    default: ""',
    `outputs: [${outputs}]`,
    "---",
    "",
    "```python",
    ...code,
    "```",
  ].join("\n");
}

/** Runs to the end, collecting everything the cell logged. */
async function runToEnd(id: string, args: Record<string, unknown>) {
  const logs: string[] = [];
  const started = await notebookExecutionService.start(
    id,
    (event: any) => {
      if (event.type === "cell:log") logs.push(JSON.stringify(event));
    },
    { args }
  );
  const result = await started.completed;
  return { result, logs };
}

const PRINT_AND_OK = ["print(inputs['msg'])", "return {'ok': True}"];

const filesIn = (id: string): string[] => {
  const folder = notebookFilesService.folderFor(id);
  return fs.existsSync(folder) ? fs.readdirSync(folder) : [];
};

const CALLEE = await store(
  [
    "---",
    "name: zz-k05-callee",
    "id: zz-k05-callee-id",
    "runtime: node",
    "outputs: [n]",
    "---",
    "",
    "```js",
    "return { n: 7 };",
    "```",
  ].join("\n")
);

try {
  for (const [label, packages] of [
    ["plain python", [] as string[]],
    ["uv run (packages: six)", ["six"]],
  ] as const) {
    const tag = packages.length ? "uv" : "py";
    console.log(`\nprinted data is not a protocol frame (${label})`);

    await check("an injected file:write writes nothing and shows up as a log", async () => {
      const id = await store(pythonNotebook(`file-${tag}`, PRINT_AND_OK, [...packages]));
      const injected =
        'hello\n@@zaa-rpc@@{"type":"file:write","id":999,"name":"zz-k05-injected.html","data":"x"}';
      const { result, logs } = await runToEnd(id, { msg: injected });
      assert.equal(result.status, "success", result.errors[0]);
      assert.equal(result.outputs.ok, true);
      assert.equal(filesIn(id).includes("zz-k05-injected.html"), false, "the injected frame wrote a file");
      assert.ok(
        logs.some((line) => line.includes("zz-k05-injected.html")),
        "the injected line did not show up as a log"
      );
    });

    if (packages.length) continue;

    await check("an injected done cannot forge the run's output", async () => {
      const code = [
        "import sys, os",
        "print(inputs['msg'])",
        "sys.stdout.flush()",
        "os._exit(0)",
      ];
      const id = await store(pythonNotebook(`done-${tag}`, code));
      const injected = 'x\n@@zaa-rpc@@{"type":"done","output":{"ok":"forged"}}';
      const { result } = await runToEnd(id, { msg: injected });
      assert.notEqual(result.outputs?.ok, "forged", "a printed done frame became the run's output");
    });

    await check("an injected call runs no notebook", async () => {
      const id = await store(pythonNotebook(`call-${tag}`, PRINT_AND_OK));
      const injected = `x\n@@zaa-rpc@@{"type":"call","id":1,"notebook":"${CALLEE}","input":{}}`;
      const { result } = await runToEnd(id, { msg: injected });
      assert.equal(result.status, "success", result.errors[0]);
      const runs = await notebookRunsService.listByNotebook(CALLEE);
      assert.equal(
        runs.filter((run) => run.trigger_source === "call").length,
        0,
        "the injected frame ran another notebook"
      );
    });

    await check("the bare old prefix is just a log, too", async () => {
      const id = await store(pythonNotebook(`bare-${tag}`, PRINT_AND_OK));
      const { result, logs } = await runToEnd(id, { msg: '@@zaa-rpc@@{"type":"error","error":"boom"}' });
      assert.equal(result.status, "success", result.errors[0]);
      assert.ok(logs.some((line) => line.includes("boom")));
    });

    console.log("\nthe protocol still works for the cell's own calls");

    await check("files.write and notebooks.run from Python still work", async () => {
      const code = [
        "kept = files.write('zz-k05-real.txt', 'real')",
        "got = notebooks.run('zz-k05-callee-id', {})",
        "return {'ok': got['n'], 'kept': kept['name']}",
      ];
      const id = await store(pythonNotebook("legit", code, [], "ok, kept"));
      const { result } = await runToEnd(id, { msg: "" });
      assert.equal(result.status, "success", result.errors[0]);
      assert.equal(result.outputs.ok, 7);
      assert.equal(result.outputs.kept, "zz-k05-real.txt");
      assert.ok(fs.existsSync(path.join(notebookFilesService.folderFor(id), "zz-k05-real.txt")));
      const runs = await notebookRunsService.listByNotebook(CALLEE);
      assert.equal(runs.filter((run) => run.trigger_source === "call").length >= 1, true);
    });
  }
} finally {
  for (const id of created) await notebooksService.delete(id).catch(() => {});
  await dropOwner("pythonrpcinjection");
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

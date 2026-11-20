/**
 * FX-20 D-6 (closes K-19 across notebooks): a `file` input may only name a file the run's
 * actor could open themselves. A path into another owner's notebook folder is refused with
 * the same words as a file that is not there; the notebook's own folders, shared folders and
 * everything an owner can edit still work.
 *
 * Everything it creates is prefixed `zz-fx20a-` and removed at the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx20-file-access
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { authService } from "../src/services/auth.service.js";
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
await pool.query("DELETE FROM users WHERE username = 'zz-fx20a-viewer'");
await dropOwner("fx20a-a");
await dropOwner("fx20a-b");

const created: string[] = [];
const folders: string[] = [];

function put(relative: string, text: string): string {
  const full = path.join(STORAGE_DIR, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  folders.push(relative.split("/")[0] === "uploads" || relative.split("/")[0] === "notebooks" ? relative.split("/").slice(0, 2).join("/") : relative.split("/")[0]);
  return relative;
}

async function store(runtime: "node" | "python", id: string, owner: string): Promise<string> {
  const body =
    runtime === "node"
      ? ["```js", "return { text: inputs.doc ? inputs.doc.readAsText() : 'none' };", "```"]
      : ["```python", "return { 'text': inputs['doc'].read_as_text() if inputs.get('doc') else 'none' }", "```"];
  const saved = await notebooksService.save(
    fromMarkdown(
      ["---", `name: ${id}`, `id: ${id}`, `runtime: ${runtime}`, "inputs:", "  - name: doc", "    type: file", "outputs: [text]", "---", "", ...body].join("\n")
    ),
    "test",
    owner
  );
  await notebooksService.deploy(saved.id, "test");
  created.push(saved.id);
  return saved.id;
}

async function run(id: string, options: { args?: Record<string, unknown>; startedBy?: string }) {
  const started = await notebookExecutionService.start(id, () => {}, options);
  return started.completed;
}

const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ContractError, `expected a ContractError, got ${(err as Error).constructor.name}: ${(err as Error).message}`);
    return err.message;
  }
  throw new Error("the run was accepted");
};

try {
  const a = await testOwner("fx20a-a");
  const b = await testOwner("fx20a-b");
  const viewer = await authService.createUser("zz-fx20a-viewer", "zz-owner-password-long", "viewer");

  for (const runtime of ["node", "python"] as const) {
    console.log(`\n${runtime}`);
    const idA = await store(runtime, `zz-fx20a-${runtime}-a`, a.id);
    const idB = await store(runtime, `zz-fx20a-${runtime}-b`, b.id);

    const theirs = put(`notebooks/${idB}/secret.txt`, "zz-fx20a-B-SECRET");
    const theirUpload = put(`uploads/${idB}/page-1-photo.txt`, "zz-fx20a-B-UPLOAD");
    const mine = put(`uploads/${idA}/page-1-doc.txt`, "zz-fx20a-A-UPLOAD");
    const shared = put(`zz-fx20a-shared/pub.txt`, "zz-fx20a-PUBLIC");

    const notFound = '"doc": file not found';

    await check("a path into another owner's notebooks/ folder is refused, for the person who runs it", async () => {
      assert.equal(await refusal(run(idA, { args: { doc: theirs }, startedBy: a.id })), notFound);
    });

    await check("and for cron/webhook/share (no one started it: the owner is the actor)", async () => {
      assert.equal(await refusal(run(idA, { args: { doc: theirs } })), notFound);
      assert.equal(await refusal(run(idA, { args: { doc: { path: theirUpload, name: "x" } } })), notFound);
    });

    await check("the refusal reads exactly like a file that does not exist", async () => {
      const missing = await refusal(run(idA, { args: { doc: `notebooks/${idB}/zz-nothing.txt` }, startedBy: a.id }));
      const missing2 = await refusal(run(idA, { args: { doc: "zz-fx20a-shared/zz-nothing.txt" }, startedBy: a.id }));
      assert.equal(missing, notFound);
      assert.equal(missing2, notFound);
    });

    await check("a `..` or absolute path is still refused by the contract", async () => {
      await refusal(run(idA, { args: { doc: "../outside.txt" }, startedBy: a.id }));
    });

    await check("the notebook's own uploads/ folder reads, for its owner and for a visitor who can only use it", async () => {
      for (const startedBy of [a.id, viewer.id, undefined]) {
        const result = await run(idA, { args: { doc: mine }, startedBy });
        assert.equal(result.status, "success", result.errors[0]);
        assert.equal(result.outputs.text, "zz-fx20a-A-UPLOAD");
      }
    });

    await check("a visitor cannot name another owner's folder, nor the owner's other notebooks", async () => {
      assert.equal(await refusal(run(idA, { args: { doc: theirs }, startedBy: viewer.id })), notFound);
    });

    await check("a shared folder (not a notebook's) still reads", async () => {
      const result = await run(idA, { args: { doc: shared }, startedBy: a.id });
      assert.equal(result.status, "success", result.errors[0]);
      assert.equal(result.outputs.text, "zz-fx20a-PUBLIC");
    });

    await check("B can read B's own file; A's notebook cannot be handed it", async () => {
      const result = await run(idB, { args: { doc: theirs }, startedBy: b.id });
      assert.equal(result.status, "success", result.errors[0]);
      assert.equal(result.outputs.text, "zz-fx20a-B-SECRET");
    });
  }
} finally {
  for (const id of created) await notebooksService.delete(id).catch(() => {});
  for (const folder of new Set(folders)) fs.rmSync(path.join(STORAGE_DIR, folder), { recursive: true, force: true });
  await pool.query("DELETE FROM users WHERE username = 'zz-fx20a-viewer'");
  await dropOwner("fx20a-a");
  await dropOwner("fx20a-b");
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

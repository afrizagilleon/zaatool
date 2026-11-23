/**
 * C-08 and C-09 — what a notebook's cells may keep on disk, and what outlives a delete.
 *
 * `files.write` used to bypass `MAX_NOTEBOOK_STORAGE_MB` entirely (the quota counted only
 * `uploads/`), checked nothing before it wrote, and wrote with `writeFileSync`. Deleting a
 * notebook while a run was going left the run writing into a folder the delete had just
 * removed — or recreating it. Each case below starts its writers together.
 *
 * Everything it makes is prefixed `zz-w2files-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test w2-files-quota-delete
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookFilesService } from "../src/services/notebook-files.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";
import { dropOwner, testOwner } from "./owners.js";
import type { NotebookJson } from "@zaa-tool/shared";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => Promise<void>): Promise<void> {
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
const owner = (await testOwner("w2files")).id;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function clean(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-w2files-%'");
  for (const row of rows) await notebooksService.delete(row.id).catch(() => undefined);
}
await clean();

const make = async (name: string, steps?: NotebookJson["steps"]): Promise<string> =>
  (
    await notebooksService.save(
      {
        version: "1.0",
        id: "",
        name,
        runtime: "node",
        steps: steps ?? [{ id: "c1", kind: "cell", code: "return {};" }],
      },
      "test",
      owner
    )
  ).id;

const MB = 1024 * 1024;
const megabyte = Buffer.alloc(MB, 1).toString("base64");
const folderBytes = (dir: string): number =>
  fs.existsSync(dir) ? fs.readdirSync(dir).reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0) : 0;

console.log("\nC-08: the quota covers what cells write");

await check("sixty cells writing 1 MB each against a 10 MB quota: no more than 10 MB lands", async () => {
  process.env.MAX_NOTEBOOK_STORAGE_MB = "10";
  try {
    const id = await make("zz-w2files-parallel");
    const write = notebookFilesService.writerFor(id);
    const results = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) => write({ name: `f${i}.bin`, data: megabyte, encoding: "base64" }))
    );
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    assert.ok(accepted <= 10, `${accepted} writes accepted against a 10 MB quota`);
    assert.ok(accepted >= 9, `only ${accepted} accepted; the quota is being applied too early`);
    assert.ok(folderBytes(notebookFilesService.folderFor(id)) <= 10 * MB);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.match(String(refused.reason.message), /MAX_NOTEBOOK_STORAGE_MB/);
  } finally {
    delete process.env.MAX_NOTEBOOK_STORAGE_MB;
  }
});

await check("what arrived in uploads/ and what cells write share one allowance", async () => {
  process.env.MAX_NOTEBOOK_STORAGE_MB = "4";
  try {
    const id = await make("zz-w2files-shared");
    notebookFilesService.keepUpload(id, "a.bin", Buffer.alloc(3 * MB, 1));
    const write = notebookFilesService.writerFor(id);
    await assert.rejects(write({ name: "b.bin", data: Buffer.alloc(2 * MB, 1).toString("base64"), encoding: "base64" }), /storage limit/);
    await write({ name: "small.txt", data: "fits", encoding: "utf8" });
    // And the other way round: cell files count against an upload.
    await write({ name: "big.bin", data: Buffer.alloc(MB / 2, 1).toString("base64"), encoding: "base64" });
    assert.throws(() => notebookFilesService.keepUpload(id, "c.bin", Buffer.alloc(MB, 1)), /storage limit/);
  } finally {
    delete process.env.MAX_NOTEBOOK_STORAGE_MB;
  }
});

await check("writing the same name again replaces the file and is not counted twice", async () => {
  process.env.MAX_NOTEBOOK_STORAGE_MB = "2";
  try {
    const id = await make("zz-w2files-replace");
    const write = notebookFilesService.writerFor(id);
    for (let i = 0; i < 6; i += 1) await write({ name: "chart.png", data: megabyte, encoding: "base64" });
    assert.equal(folderBytes(notebookFilesService.folderFor(id)), MB);
  } finally {
    delete process.env.MAX_NOTEBOOK_STORAGE_MB;
  }
});

await check("thirty writers of one name leave one complete file and no temporary ones", async () => {
  const id = await make("zz-w2files-atomic");
  const write = notebookFilesService.writerFor(id);
  await Promise.all(
    Array.from({ length: 30 }, (_, i) => write({ name: "same.txt", data: String.fromCharCode(65 + (i % 26)).repeat(50_000), encoding: "utf8" }))
  );
  const folder = notebookFilesService.folderFor(id);
  assert.deepEqual(fs.readdirSync(folder), ["same.txt"]);
  const text = fs.readFileSync(path.join(folder, "same.txt"), "utf8");
  assert.equal(text.length, 50_000);
  assert.equal(new Set(text).size, 1, "two writers' bytes are mixed in one file");
});

await check("a write does not stop the event loop", async () => {
  const id = await make("zz-w2files-loop");
  const write = notebookFilesService.writerFor(id);
  let ticks = 0;
  const timer = setInterval(() => (ticks += 1), 1);
  try {
    const big = Buffer.alloc(8 * MB, 2).toString("base64");
    await Promise.all(Array.from({ length: 4 }, (_, i) => write({ name: `big${i}.bin`, data: big, encoding: "base64" })));
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks >= 3, `the loop ticked ${ticks} times while 32 MB was written`);
});

console.log("\nC-09: deleting a notebook that is running");

await check("a notebook that no longer exists cannot keep files, and no folder comes back", async () => {
  const id = await make("zz-w2files-gone");
  const write = notebookFilesService.writerFor(id);
  await notebooksService.delete(id);
  await assert.rejects(write({ name: "late.txt", data: "after", encoding: "utf8" }), /no longer exists/);
  assert.equal(fs.existsSync(notebookFilesService.folderFor(id)), false);
});

await check("deleting cancels the run that is still going, and its late write leaves nothing behind", async () => {
  const id = await make("zz-w2files-late", [
    {
      id: "c1",
      kind: "cell",
      timeoutMs: 30_000,
      code: "await new Promise(r => setTimeout(r, 2500)); await files.write('late.txt', 'after delete'); return {};",
    },
  ]);
  const started = await notebookExecutionService.start(id, () => {}, { triggerSource: "manual", startedBy: owner });
  await sleep(800);

  const began = Date.now();
  await notebooksService.delete(id);
  const result = await started.completed;
  await sleep(300);

  assert.equal(result.status, "failed", "the run carried on to the end after its notebook was deleted");
  assert.match(String(result.errors[0]), /Cancelled/i);
  assert.ok(Date.now() - began < 2400, "delete waited for the cell to finish instead of cancelling it");
  assert.equal(fs.existsSync(path.join(STORAGE_DIR, "notebooks", id)), false, "an orphan folder was left");
  assert.equal(fs.existsSync(path.join(STORAGE_DIR, "uploads", id)), false);
  const { rows } = await pool.query("SELECT 1 FROM notebooks WHERE id = $1", [id]);
  assert.equal(rows.length, 0);
});

await clean();
await dropOwner("w2files");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

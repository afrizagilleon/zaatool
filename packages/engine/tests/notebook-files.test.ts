/**
 * M19 — files, and the two doors they come through.
 *
 * `render: image` and `render: file` have been in the vocabulary since M13, and until now
 * nothing in this system could produce a value for either of them. A notebook could draw a
 * chart and had nowhere to put it; somebody could photograph a receipt and had no way to
 * send it. This is both halves of that: `files.write` on the way out, a `file` input and a
 * multipart webhook on the way in.
 *
 * The claim under test is not "a file can be written". It is that a file is written *where
 * the engine decided*, under a name the engine chose, readable only through a signed link
 * — none of which the cell, the request, or the notebook's author gets a say in.
 *
 * Notebooks it creates are prefixed `zz-files-` and left behind.
 *
 *   pnpm --filter @zaa-tool/engine test notebook-files
 */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { notebookFilesService } from "../src/services/notebook-files.service.js";
import { secretsService } from "../src/services/secrets.service.js";
import { authService } from "../src/services/auth.service.js";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";
import { OUTPUT_RENDERS } from "../src/core/notebook-outputs.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookPage } from "@zaa-tool/shared";
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
const OWNER = (await testOwner("notebookfiles")).id;

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

await pool.query("DELETE FROM users WHERE username = 'zz-files-user'").catch(() => {});
await authService.createUser("zz-files-user", "zz-files-password", "creator");
const token = (await authService.login("zz-files-user", "zz-files-password")).token;
const auth = { Authorization: `Bearer ${token}` };

async function store(text: string, deploy = true): Promise<string> {
  const saved = await notebooksService.save(fromMarkdown(text), "test", OWNER);
  // A fixed id left by an earlier run keeps its old owner, who is gone.
  await pool.query("UPDATE notebooks SET owner_id = $1 WHERE id = $2", [OWNER, saved.id]);
  if (deploy) await notebooksService.deploy(saved.id, "test");
  return saved.id;
}

/** Runs a notebook to completion and hands back what it declared. */
async function runToEnd(id: string, args?: Record<string, unknown>) {
  const started = await notebookExecutionService.start(id, () => {}, { args });
  return started.completed;
}

// ── writing ───────────────────────────────────────────────────────────────────

console.log("\na cell keeps a file");

const WRITER = await store(
  [
    "---",
    "name: zz-files-writer",
    "id: zz-files-writer-id",
    "runtime: node",
    "inputs:",
    "  - name: body",
    "    type: string",
    "    default: hello",
    "outputs: [kept]",
    "---",
    "",
    "```js",
    'const kept = await files.write("note.txt", inputs.body);',
    "return { kept };",
    "```",
  ].join("\n")
);

await check("what comes back is a path, a size, a type and a signed link", async () => {
  const result = await runToEnd(WRITER);
  assert.equal(result.status, "success", result.errors[0]);

  const kept = result.outputs.kept as Record<string, unknown>;
  assert.equal(kept.name, "note.txt");
  assert.equal(kept.path, `notebooks/${WRITER}/note.txt`);
  assert.equal(kept.mime, "text/plain");
  assert.equal(kept.size, 5);
  assert.match(String(kept.url), /^\/storage\/notebooks\/.+\?exp=\d+&sig=/);
});

await check("the link works with no session at all, and the bare path does not", async () => {
  const result = await runToEnd(WRITER, { body: "signed and served" });
  const kept = result.outputs.kept as { url: string; path: string };

  const signed = await fetch(`${base}${kept.url}`);
  assert.equal(signed.status, 200);
  assert.equal(await signed.text(), "signed and served");

  const bare = await fetch(`${base}/storage/${kept.path}`);
  assert.equal(bare.status, 401);
});

await check("the same name replaces the file rather than piling up", async () => {
  await runToEnd(WRITER, { body: "first" });
  await runToEnd(WRITER, { body: "second" });

  const folder = notebookFilesService.folderFor(WRITER);
  const written = fs.readdirSync(folder);
  assert.deepEqual(written, ["note.txt"], `expected one file, found ${written.join(", ")}`);
  assert.equal(fs.readFileSync(path.join(folder, "note.txt"), "utf8"), "second");
});

await check("a name that climbs out lands in the notebook's own folder", async () => {
  const id = await store(
    [
      "---",
      "name: zz-files-escape",
      "id: zz-files-escape-id",
      "runtime: node",
      "outputs: [kept]",
      "---",
      "",
      "```js",
      'const kept = await files.write("../../planted.txt", "nope");',
      "return { kept };",
      "```",
    ].join("\n")
  );

  const result = await runToEnd(id);
  assert.equal(result.status, "success", result.errors[0]);
  const kept = result.outputs.kept as { path: string };
  assert.equal(kept.path, `notebooks/${id}/planted.txt`);
  assert.equal(fs.existsSync(path.resolve(STORAGE_DIR, "../../planted.txt")), false);
});

await check("a cell cannot write something enormous, and is told why", async () => {
  const id = await store(
    [
      "---",
      "name: zz-files-huge",
      "id: zz-files-huge-id",
      "runtime: node",
      "outputs: [kept]",
      "---",
      "",
      "```js",
      'const kept = await files.write("huge.bin", "x".repeat(30 * 1024 * 1024));',
      "return { kept };",
      "```",
    ].join("\n")
  );

  const result = await runToEnd(id);
  assert.equal(result.status, "failed");
  assert.match(result.errors.join(" "), /larger than|MB a cell may write/);
});

// ── reading ───────────────────────────────────────────────────────────────────

console.log("\na cell reads a file it was given");

await check("a `file` input arrives as something with readAsText on it", async () => {
  const kept = notebookFilesService.keepUpload(
    "zz-files-reader-id",
    "receipt.txt",
    Buffer.from("total 42000"),
    "page"
  );

  const id = await store(
    [
      "---",
      "name: zz-files-reader",
      "id: zz-files-reader-id",
      "runtime: node",
      "inputs:",
      "  - name: doc",
      "    type: file",
      "    accept: text/*",
      "outputs: [contents, echoed]",
      "---",
      "",
      "```js",
      "return { contents: inputs.doc.readAsText(), echoed: inputs.doc };",
      "```",
    ].join("\n")
  );

  const result = await runToEnd(id, { doc: kept });
  assert.equal(result.status, "success", result.errors[0]);
  assert.equal(result.outputs.contents, "total 42000");

  // The path it can read from is this machine's disk, and must not come back out.
  const echoed = result.outputs.echoed as Record<string, unknown>;
  assert.equal(echoed.absolute_path, undefined, "the server's disk layout left in an output");
});

await check("a file that is not a file is refused before anything runs", async () => {
  const id = await store(
    [
      "---",
      "name: zz-files-refuser",
      "id: zz-files-refuser-id",
      "runtime: node",
      "inputs:",
      "  - name: doc",
      "    type: file",
      "    required: true",
      "outputs: [ok]",
      "---",
      "",
      "```js",
      "return { ok: 1 };",
      "```",
    ].join("\n")
  );

  await assert.rejects(() => runToEnd(id, { doc: 42 }), /expected a file/);
});

// ── the webhook ───────────────────────────────────────────────────────────────

console.log("\na photograph, posted to a webhook");

await pool.query("DELETE FROM secrets WHERE key = 'ZZ_FILES_HOOK'").catch(() => {});
await secretsService.create(OWNER, "ZZ_FILES_HOOK", "zz-files-hook-secret", true);

const GUARDED_SLUG = "zz-files-guarded-slug";
const OPEN_SLUG = "zz-files-open-webhook-slug";

await store(
  [
    "---",
    "name: zz-files-hook",
    "id: zz-files-hook-id",
    "runtime: node",
    "inputs:",
    "  - name: photo",
    "    type: file",
    "outputs: [bytes]",
    "triggers:",
    "  - kind: webhook",
    `    slug: ${GUARDED_SLUG}`,
    "    secretKey: ZZ_FILES_HOOK",
    "---",
    "",
    "```js",
    "return { bytes: inputs.photo.readAsText().length };",
    "```",
  ].join("\n")
);

await store(
  [
    "---",
    "name: zz-files-open-hook",
    "id: zz-files-open-hook-id",
    "runtime: node",
    "inputs:",
    "  - name: photo",
    "    type: file",
    "outputs: [bytes]",
    "triggers:",
    "  - kind: webhook",
    `    slug: ${OPEN_SLUG}`,
    "---",
    "",
    "```js",
    "return { bytes: 0 };",
    "```",
  ].join("\n")
);

function withFile(name: string, contents: string): FormData {
  const form = new FormData();
  form.append("photo", new Blob([contents]), name);
  return form;
}

await check("a hook with no secret takes no files, whatever it takes otherwise", async () => {
  const res = await fetch(`${base}/hooks/${OPEN_SLUG}`, {
    method: "POST",
    body: withFile("photo.txt", "should not be kept"),
  });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /secretKey/);
});

await check("the wrong secret is refused before the file is looked at", async () => {
  const res = await fetch(`${base}/hooks/${GUARDED_SLUG}`, {
    method: "POST",
    headers: { "X-Webhook-Secret": "wrong" },
    body: withFile("photo.txt", "nope"),
  });
  assert.equal(res.status, 401);
});

await check("the right secret binds the file to the input named by the field", async () => {
  const res = await fetch(`${base}/hooks/${GUARDED_SLUG}`, {
    method: "POST",
    headers: { "X-Webhook-Secret": "zz-files-hook-secret" },
    body: withFile("photo.txt", "twelve bytes"),
  });

  const body = (await res.json()) as { status: string; outputs?: Record<string, unknown> };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.outputs?.bytes, 12);
});

// ── a notebook that is only prose ─────────────────────────────────────────────

console.log("\na notebook nobody can run still has a page");

await store(
  [
    "---",
    "name: zz-files-written",
    "id: zz-files-written-id",
    "runtime: node",
    "---",
    "",
    "> ## How the月 close works",
    "> Two people sign it off.",
    "",
    "```js",
    "return {};",
    "```",
  ].join("\n").replace("月", " month ")
);

await check("its notes are the page, and no page with results grows any", async () => {
  const res = await fetch(`${base}/api/notebooks/pages`, { headers: auth });
  const pages = (await res.json()) as NotebookPage[];

  const written = pages.find((page) => page.name === "zz-files-written");
  assert.ok(written, "a notebook of nothing but prose was left out of the pages");
  assert.equal(written.notes.length, 1);
  assert.match(written.notes[0], /Two people sign it off/);

  const withOutputs = pages.find((page) => page.name === "zz-files-writer");
  assert.ok(withOutputs);
  assert.deepEqual(withOutputs.notes, [], "a page with results carried its author's notes");
});

// ── the vocabulary ────────────────────────────────────────────────────────────

check("video and audio are things an output may declare", () => {
  assert.ok(OUTPUT_RENDERS.includes("video"));
  assert.ok(OUTPUT_RENDERS.includes("audio"));
});

await pool.query("DELETE FROM users WHERE username = 'zz-files-user'").catch(() => {});
await dropOwner("notebookfiles");
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

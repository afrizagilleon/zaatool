import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/server/app.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";
import { signStorageLink } from "../src/core/storage-links.js";
import { authService } from "../src/services/auth.service.js";

/**
 * Nothing under /storage may run script in the app's origin.
 *
 * Files are served from the same origin as the app, and an anonymous visitor can upload one
 * through a share link. The session token lives in localStorage, so an HTML or SVG file
 * opened from its link was a way to take over the session of whoever opened it.
 */
const PREFIX = "zz-sec-k04-";
const DIR = "zz-k04";
const dirAbs = path.join(STORAGE_DIR, DIR);

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

const { pool } = await import("../src/db/connection.js");
const sweep = () => pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);

fs.rmSync(dirAbs, { recursive: true, force: true });
fs.mkdirSync(dirAbs, { recursive: true });
const files: Record<string, string> = {
  "poc.html": "<script>alert(localStorage.getItem('token'))</script>",
  "poc.svg": "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
  "poc.xhtml": "<html xmlns='http://www.w3.org/1999/xhtml'><script>1</script></html>",
  "poc.js": "alert(1)",
  "pic.png": "not really a png",
  "clip.mp3": "x",
  "clip.mp4": "x",
  "note.txt": "hello",
  "data.json": "{}",
  "table.csv": "a,b\n1,2\n",
  "doc.pdf": "%PDF-1.4",
};
for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dirAbs, name), body);

await sweep();
const username = `${PREFIX}u-${Date.now()}`;
await authService.createUser(username, "password123456", "creator");
const login = await authService.login(username, "password123456");

const server = createApp(() => {}).listen(0);
const address = server.address();
const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
const get = (name: string) => fetch(`${base}${signStorageLink(`${DIR}/${name}`)}`);

console.log("\nstorage-headers (uploaded files cannot run script in the app origin)");

try {
  for (const name of ["poc.html", "poc.svg", "poc.xhtml", "poc.js"]) {
    await check(`${name}: attachment + nosniff + CSP sandbox`, async () => {
      const res = await get(name);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="poc\./);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.match(res.headers.get("content-security-policy") ?? "", /^sandbox;/);
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    });
  }

  for (const name of ["pic.png", "clip.mp3", "clip.mp4", "note.txt", "data.json", "table.csv"]) {
    await check(`${name}: inline + nosniff + CSP sandbox`, async () => {
      const res = await get(name);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-disposition"), null);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.match(res.headers.get("content-security-policy") ?? "", /^sandbox;/);
    });
  }

  await check("doc.pdf: inline + nosniff + CSP without script (no sandbox, so the viewer renders)", async () => {
    const res = await get("doc.pdf");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-disposition"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  });

  await check("a filename with odd characters is encoded in Content-Disposition", async () => {
    fs.writeFileSync(path.join(dirAbs, "we irdé.html"), "x");
    const res = await get("we irdé.html");
    const cd = res.headers.get("content-disposition") ?? "";
    assert.match(cd, /^attachment; filename="we ird_\.html"; filename\*=UTF-8''we%20ird%C3%A9\.html$/);
  });

  await check("unsigned request is still 401, with the hardening headers", async () => {
    const res = await fetch(`${base}/storage/${DIR}/poc.html`);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  await check("tampered signature is still 401", async () => {
    const link = signStorageLink(`${DIR}/note.txt`).replace(/sig=./, "sig=X");
    assert.equal((await fetch(`${base}${link}`)).status, 401);
  });

  await check("bearer token still reads a file (text preview path)", async () => {
    const res = await fetch(`${base}/storage/${DIR}/note.txt`, {
      headers: { Authorization: `Bearer ${login.token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hello");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
} finally {
  server.close();
  fs.rmSync(dirAbs, { recursive: true, force: true });
  await sweep();
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

/**
 * FX-20 D-8: a cell cannot read the storage folder. JavaScript is stopped by node's
 * permission model on every platform; on Linux with the sandbox on the folder is also root's
 * and 0700 (the kernel proof is the Docker run, T-07). Here: the JS half for real, and the
 * folder-closing call recorded.
 *
 *   pnpm --filter @zaa-tool/engine test fx20-storage
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCellHost, secureStorageRoot } from "../src/core/cell-workspace.js";
import { runJsNode } from "../src/core/js-runner.js";
import type { SandboxConfig } from "../src/core/sandbox-identity.js";
import { STORAGE_DIR } from "../src/services/storage.service.js";

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

const DENIED = /ERR_ACCESS_DENIED|Access to this API has been restricted/i;

const inStorage = path.join(STORAGE_DIR, "zz-fx20st-files");
fs.mkdirSync(inStorage, { recursive: true });
fs.writeFileSync(path.join(inStorage, "private.txt"), "zz-fx20st-PRIVATE");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zz-fx20st-"));

try {
  console.log("\nJavaScript cell vs the storage folder");

  await check("reading a file under STORAGE_DIR directly is denied by the runtime", async () => {
    const res = await runJsNode(
      "return require('fs').readFileSync(inputs.p, 'utf8');",
      { p: path.join(inStorage, "private.txt") },
      20000
    );
    assert.ok(res.error, `expected failure, got ${JSON.stringify(res.output)}`);
    assert.match(res.error!, DENIED);
  });

  await check("listing STORAGE_DIR, and the folder above it, is denied", async () => {
    for (const dir of [STORAGE_DIR, path.dirname(STORAGE_DIR)]) {
      const res = await runJsNode("return require('fs').readdirSync(inputs.p);", { p: dir }, 20000);
      assert.ok(res.error, `listed ${dir}`);
      assert.match(res.error!, DENIED);
    }
  });

  await check("a granted file is read from the cell's own folder, and the original path is still denied", async () => {
    const host = createCellHost({ tempRoot, ownerKey: "o1", grants: new Set(["zz-fx20st-files/private.txt"]) });
    const res = await runJsNode(
      `const fs = require('fs');
       const own = inputs.doc.readAsText();
       let original = 'readable';
       try { fs.readFileSync(inputs.p, 'utf8'); } catch (err) { original = err.code; }
       return { own, original };`,
      { doc: { name: "private.txt", path: "zz-fx20st-files/private.txt" }, p: path.join(inStorage, "private.txt") },
      20000,
      undefined,
      {},
      [{ name: "doc", type: "file" }],
      undefined,
      undefined,
      [],
      undefined,
      host
    );
    assert.equal(res.error, undefined, res.error);
    assert.deepEqual(res.output, { own: "zz-fx20st-PRIVATE", original: "ERR_ACCESS_DENIED" });
  });

  await check("another cell's folder is denied too: only the cell's own is readable", async () => {
    const host = createCellHost({ tempRoot, ownerKey: "o1", grants: new Set(["zz-fx20st-files/private.txt"]) });
    const neighbour = host.open({ path: "zz-fx20st-files/private.txt" });
    try {
      const [theirCopy] = Object.values(neighbour.staged);
      assert.ok(theirCopy);
      const res = await runJsNode("return require('fs').readFileSync(inputs.p, 'utf8');", { p: theirCopy }, 20000, undefined, {}, [], undefined, undefined, [], undefined, host);
      assert.ok(res.error, "a cell read another process's staged file");
      assert.match(res.error!, DENIED);
    } finally {
      neighbour.dispose();
    }
  });

  console.log("\nthe folder itself");

  await check("with a sandbox, storage is made root's and 0700; without one, nothing is touched", () => {
    const config: SandboxConfig = { uidBase: 20000, uidCount: 40000, gid: 10001, home: "/home/sandbox" };
    const calls: string[] = [];
    const recording = {
      mkdirSync: (dir: string) => void calls.push(`mkdir ${dir}`),
      chmodSync: (target: string, mode: number) => void calls.push(`chmod ${mode.toString(8)} ${target}`),
      chownSync: (target: string, uid: number, gid: number) => void calls.push(`chown ${uid}:${gid} ${target}`),
    };
    assert.equal(secureStorageRoot(config, "/app/packages/storage", recording), true);
    assert.deepEqual(calls, ["mkdir /app/packages/storage", "chown 0:0 /app/packages/storage", "chmod 700 /app/packages/storage"]);

    calls.length = 0;
    assert.equal(secureStorageRoot(undefined, "/app/packages/storage", recording), false);
    assert.deepEqual(calls, []);
  });
} finally {
  fs.rmSync(inStorage, { recursive: true, force: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

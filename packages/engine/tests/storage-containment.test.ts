/**
 * Containment of file-input paths: symlinks inside storage must not reach outside it, and
 * a caller-supplied `url` on a file input is ignored (derived from the validated path).
 * No database needed. Everything lives in temp folders prefixed `zz-k19-`.
 *
 *   pnpm --filter @zaa-tool/engine test storage-containment
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeSubPath } from "../src/core/storage-paths.js";
import { bindInputs } from "../src/core/notebook-contract.js";
import { STORAGE_DIR } from "../src/core/storage-root.js";
import { STORAGE_DIR as REEXPORTED } from "../src/services/storage.service.js";

let passed = 0;
let failed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n").join("\n       ")}`);
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zz-k19-root-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zz-k19-out-"));
fs.mkdirSync(path.join(root, "sub"));
fs.writeFileSync(path.join(root, "sub", "ok.txt"), "ok");
fs.writeFileSync(path.join(outside, "secret.txt"), "secret");

let linkKind = "none";
const link = path.join(root, "sub", "escape");
try {
  fs.symlinkSync(outside, link, "dir");
  linkKind = "symlink";
} catch {
  try {
    fs.symlinkSync(outside, link, "junction");
    linkKind = "junction";
  } catch {
    linkKind = "none";
  }
}
console.log(`\nlink kind available: ${linkKind}`);

try {
  console.log("\nstorage containment");

  check("STORAGE_DIR is re-exported from the service unchanged", () => {
    assert.equal(REEXPORTED, STORAGE_DIR);
  });

  check("a normal file is accepted", () => {
    assert.equal(safeSubPath("sub/ok.txt", root), "sub/ok.txt");
  });

  check("a file that does not exist yet is accepted without throwing", () => {
    assert.equal(safeSubPath("sub/new/file.txt", root), "sub/new/file.txt");
  });

  check("a symlink inside storage pointing outside is refused", () => {
    if (linkKind === "none") {
      console.log("       (no symlink or junction could be created here; skipped)");
      return;
    }
    assert.equal(safeSubPath("sub/escape/secret.txt", root), null);
    assert.equal(safeSubPath("sub/escape", root), null);
    assert.equal(safeSubPath("sub/escape/not-yet.txt", root), null);
  });

  check("a root that is itself reached through a link still accepts its own files", () => {
    if (linkKind === "none") return;
    const viaLink = path.join(outside, "rootlink");
    try {
      fs.symlinkSync(root, viaLink, linkKind === "junction" ? "junction" : "dir");
    } catch {
      return;
    }
    assert.equal(safeSubPath("sub/ok.txt", viaLink), "sub/ok.txt");
  });

  const params = [{ name: "doc", type: "file" }] as unknown as Parameters<typeof bindInputs>[0];

  check("a caller-supplied url is ignored and derived from the path", () => {
    const bound = bindInputs(params, {
      doc: { path: "zz-k19-none/file.txt", url: "https://evil.example/steal" },
    }) as { doc: { path: string; url: string } };
    assert.notEqual(bound.doc.url, "https://evil.example/steal");
    assert.match(bound.doc.url, /^\/storage\/zz-k19-none\/file\.txt\?exp=\d+&sig=/);
  });

  check("a bare string path also gets a derived url", () => {
    const bound = bindInputs(params, { doc: "zz-k19-none/file.txt" }) as { doc: { url: string } };
    assert.match(bound.doc.url, /^\/storage\/zz-k19-none\/file\.txt\?exp=/);
  });
} finally {
  try {
    if (linkKind !== "none") fs.rmSync(link, { recursive: true, force: false });
  } catch {
    // best effort; the junction removal below handles the rest
  }
  // The link itself, never what it points at. rmSync refuses a junction ("Path is a directory")
  // on Windows machines that cannot make symlinks; unlink removes a symlink or a junction alike.
  const rootLink = path.join(outside, "rootlink");
  try {
    if (fs.lstatSync(rootLink).isSymbolicLink()) fs.unlinkSync(rootLink);
    else fs.rmSync(rootLink, { force: true, recursive: false });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

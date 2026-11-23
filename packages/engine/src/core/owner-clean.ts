/**
 * Emptying an owner's temp folder and package cache, as one of their own cell processes (S-14).
 *
 * Those folders are root's and group-writable (see `owner-home`), and a cell can put anything
 * in them, a symlink included. The engine is root, so it must never delete, `chown` or `chmod`
 * inside them (C-01): a link planted in the folder would turn that into a root-powered change
 * to wherever it points. The engine only *measures* them (`lstat`, in `owner-disk`).
 *
 * What it does instead is what the C-01 fix does for a process's own folder: it opens a
 * workspace with `host.open()`, which leases a uid from the pool in the owner's group, and
 * runs the clean-up as that uid with `umask 007`, like a cell. A folder that is 2770 holding
 * files that are 0660/0770 can be emptied by any member of the group, and a symlink is no more
 * powerful in the hands of that uid than the cell that planted it already was. When the
 * workspace is disposed the uid is swept and returned like any other.
 *
 * Without the sandbox (a developer's machine, Windows) there is no other user to protect
 * anything from: the folder is the engine's own and is emptied in-process.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installLimits } from "../config.js";
import type { CellHost, CellWorkspace } from "./cell-workspace.js";
import { limitedCommand } from "./cell-limits.js";
import { killTree, TREE_SPAWN_OPTIONS } from "./kill-tree.js";
import { guardCellFromOom } from "./oom-guard.js";
import { buildSandboxEnv } from "./sandbox-env.js";

/** What to do to an owner's folders. */
export type CleanJob = "tmp" | "uv-prune" | "uv-cache";

/** Longest the helper may take: `uv cache prune` of a big cache is the slow one. */
const CLEAN_TIMEOUT_MS = 120_000;

/**
 * Runs as the cell's uid (`node -e`, so it needs no file of its own). `process.argv[1]` is the
 * folder whose contents go. Everything is `lstat`ed, never followed; a folder it cannot enter
 * is left, and the exit code says whether anything is left at all.
 */
export const CLEAN_SCRIPT = String.raw`
const fs = require("fs");
process.umask(0o007);
let left = 0;
function remove(target) {
  let info;
  try { info = fs.lstatSync(target); } catch { return; }
  if (info.isDirectory()) {
    try { fs.chmodSync(target, 0o770); } catch { /* not ours to change */ }
    let names = [];
    try { names = fs.readdirSync(target); } catch { left += 1; return; }
    for (const name of names) remove(target + "/" + name);
    try { fs.rmdirSync(target); } catch { left += 1; }
  } else {
    try { fs.unlinkSync(target); } catch { left += 1; }
  }
}
let names = [];
try { names = fs.readdirSync(process.argv[1]); } catch { process.exit(0); }
for (const name of names) remove(process.argv[1] + "/" + name);
process.exit(left === 0 ? 0 : 3);
`;

/** Removes everything inside `dir` (not `dir`), without following a symlink, nothing outside `boundary`. Only for a machine without the sandbox. */
export async function clearDirContents(dir: string, boundary: string): Promise<boolean> {
  try {
    const st = await fs.promises.lstat(dir);
    if (!st.isDirectory()) return false;
    const [realDir, realBoundary] = await Promise.all([fs.promises.realpath(dir), fs.promises.realpath(boundary)]);
    if (!realDir.startsWith(realBoundary + path.sep)) return false;
    for (const name of await fs.promises.readdir(dir)) {
      // `rm` lstat()s each entry: a symlink is unlinked, its target is not visited.
      await fs.promises.rm(path.join(dir, name), { recursive: true, force: true }).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

function runAs(workspace: CellWorkspace, bin: string, args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const identity = workspace.spawn;
      const command = limitedCommand({ bin, args }, "install", installLimits(), identity.options.uid !== undefined);
      const proc = spawn(command.bin, command.args, {
        env: { ...buildSandboxEnv({}), ...identity.env },
        stdio: "ignore",
        ...TREE_SPAWN_OPTIONS,
        ...identity.options,
      });
      guardCellFromOom(proc.pid, identity.options.uid !== undefined);
      const timer = setTimeout(() => killTree(proc), CLEAN_TIMEOUT_MS);
      timer.unref();
      proc.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Does `job` to the owner of `host`. Resolves whether it ran to the end; never rejects.
 * `tmp` empties their temp folder, `uv-cache` their package cache, `uv-prune` runs
 * `uv cache prune` on it.
 */
export async function cleanAsOwner(host: CellHost, job: CleanJob): Promise<boolean> {
  let workspace: CellWorkspace;
  try {
    workspace = host.open();
  } catch {
    return false; // no uid free right now: the next idle period tries again
  }
  try {
    const tmp = path.join(host.home, "tmp");
    const cache = path.join(host.home, ".cache", "uv");
    if (workspace.spawn.options.uid === undefined) {
      if (job === "tmp") return await clearDirContents(tmp, host.home);
      if (job === "uv-cache") return await clearDirContents(cache, host.home);
      return false; // a machine without the sandbox has no cache of ours to prune
    }
    if (job === "uv-prune") return await runAs(workspace, process.env.UV_PATH || "uv", ["cache", "prune", "--quiet"]);
    return await runAs(workspace, process.execPath, ["-e", CLEAN_SCRIPT, job === "tmp" ? tmp : cache]);
  } finally {
    await workspace.dispose();
  }
}

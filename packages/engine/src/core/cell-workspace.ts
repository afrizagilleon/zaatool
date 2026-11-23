/**
 * Where a cell process lives, and what it is handed.
 *
 * Every cell process gets a folder of its own, made by the engine before the process starts
 * and removed when it is over (`<owner home>/cells/<128 random bits>/`). On Linux with the
 * sandbox on the process also gets a uid of its own for its whole life, leased from the pool
 * in `uid-sweep`, and the folder belongs to that uid (0700): no other process, of this owner
 * or any other, can enter it. The rest of the owner's layout, and why it is safe for root to
 * set it up, is in `owner-home`. Elsewhere the same layout is made under the system temp
 * folder, owned by whoever runs the engine, so the code path is the one that is tested.
 *
 * The storage folder is *not* readable by a cell. A cell reads only what the engine copied
 * into its folder: that is the whole file-input story (see {@link CellWorkspace.stageFrom}).
 * Nothing here touches the database: the owner's gid arrives already allocated.
 *
 * What root may do inside a folder a cell can write to is deliberately narrow (C-01; the
 * rules are in `workspace-fs`): it makes the folder and hands it over by descriptor, writes
 * the program's script into it before the process exists, and from then on copies files into
 * it only through a helper that has become the process's own uid.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { safeFilename, safeSubPath } from "./storage-paths.js";
import { STORAGE_DIR } from "./storage-root.js";
import { ownerSpawnIdentity, type CellSpawnIdentity, type SandboxConfig } from "./sandbox-identity.js";
import { PROCESS_DIR_MODE, prepareOwnerHome } from "./owner-home.js";
import { sharedUidPool, type UidPool } from "./uid-sweep.js";
import { nodeWorkspaceFs, type WorkspaceFs } from "./workspace-fs.js";

export type { WorkspaceFs } from "./workspace-fs.js";

const NO_IDENTITY: CellSpawnIdentity = { options: {}, env: {} };

export interface CellWorkspace {
  /** The process's own folder: its working directory, and the only place a JavaScript cell may read. */
  dir: string;
  /** Spawn options and environment for this process: its own uid, its owner's group. */
  spawn: CellSpawnIdentity;
  /**
   * Storage path (relative, forward slashes) of every file copied into this folder so far,
   * to where its copy is. A cell finds a file it was given by this and by nothing else.
   */
  staged: Record<string, string>;
  /**
   * Copies into this folder every file described anywhere in `value` (an object with a
   * string `path`) that this run's chain was granted, and returns the copies it just made.
   * A `path` that was not granted is skipped, not an error: it is only data.
   */
  stageFrom(value: unknown): Record<string, string>;
  /**
   * Puts a file of the engine's own making (a program the process will run) in the folder, mode
   * 0600 and the process's own, and returns its path. Only before the process is spawned: it is
   * the one place root writes into the folder directly, which is safe because nothing of this
   * uid can exist yet.
   */
  writeScript(name: string, content: string): string;
  /**
   * Ends the process's claim on everything: kills whatever of its uid is left, empties and
   * removes the folder, and gives the uid back. Callable more than once (the runners call it
   * when they give up on a process and again when it has really exited); the promise it
   * returns is for tests and never rejects, and a runner does not wait for it.
   */
  dispose(): Promise<void>;
}

export interface CellHost {
  /** The owner's folder: what the disk quota measures (`core/owner-disk`). */
  home: string;
  /** A fresh folder (and, in the sandbox, uid) for one cell process, with the granted files in `inputs` already in it. */
  open(inputs?: unknown): CellWorkspace;
}

export interface CellHostOptions {
  /** Set when cells change uid: the owner's allocated gid under that sandbox. */
  sandbox?: { config: SandboxConfig; gid: number; pool?: UidPool };
  /** Without a sandbox: where folders go. Defaults to a folder under the system temp. */
  tempRoot?: string;
  /** Without a sandbox: names the owner's folder under `tempRoot` (any string; made safe). */
  ownerKey?: string;
  fs?: WorkspaceFs;
  /**
   * Storage paths this chain of runs may copy into a cell, read live. The engine's runs always
   * pass one. Left out, every path that is inside storage may be copied: that is the host of a
   * caller that is the engine's own code (a script, a test), which chose the inputs itself.
   */
  grants?: Set<string>;
  /** The storage folder the grants are relative to. */
  storageDir?: string;
}

/** A folder name that is one safe segment whatever the owner id turns out to be. */
function keyOf(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "none";
}

export function createCellHost(options: CellHostOptions): CellHost {
  const wfs = options.fs ?? nodeWorkspaceFs;
  const sandbox = options.sandbox;
  const grants = options.grants;
  const storageDir = options.storageDir ?? STORAGE_DIR;

  let home: string;
  // The sandbox is Linux, and its paths are POSIX whatever machine a test runs on.
  const join = sandbox ? path.posix.join : path.join;
  const pool = sandbox ? (sandbox.pool ?? sharedUidPool(sandbox.config)) : undefined;

  if (sandbox) {
    home = prepareOwnerHome(sandbox.config, sandbox.gid, wfs);
  } else {
    home = path.join(
      options.tempRoot ?? path.join(os.tmpdir(), "zaatool-cells"),
      "owners",
      keyOf(options.ownerKey ?? "none")
    );
  }

  return {
    home,
    open(inputs?: unknown): CellWorkspace {
      const cells = join(home, "cells");
      const dir = join(cells, randomBytes(16).toString("hex"));

      // The process's uid, for the whole life of this folder.
      const lease = sandbox && pool ? pool.lease(sandbox.gid) : undefined;
      let spawn: CellSpawnIdentity = NO_IDENTITY;
      let closing: Promise<void> | undefined;

      const close = (): Promise<void> => {
        if (lease) {
          // The sweep helper empties the folder as the uid; root then removes it, empty.
          closing ??= lease.release(dir).then(() => {
            try {
              wfs.rmdirSync(dir);
            } catch {
              // not empty or already gone: the next start clears `cells/`
            }
          });
          return closing;
        }
        // Repeatable on purpose: the runners call it when they give up on a process and
        // again when it has really exited, and the second call removes what it wrote between.
        // Never throws: on Windows a process that has only just exited can still hold the
        // folder, and the call that follows its real exit removes it.
        try {
          wfs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
        } catch {
          // left for the next call
        }
        return Promise.resolve();
      };

      try {
        if (sandbox && lease) {
          wfs.mkdirSync(dir, { mode: PROCESS_DIR_MODE });
          wfs.adoptDirectory(dir, lease.uid, sandbox.gid, PROCESS_DIR_MODE);
          const identity = ownerSpawnIdentity(sandbox.config, sandbox.gid, lease.uid);
          // The working directory is the process's own folder: nothing else is reachable by
          // relative name, and the cell's code is never named on the command line.
          spawn = { options: { ...identity.options, cwd: dir }, env: identity.env };
        } else {
          wfs.mkdirSync(dir, { recursive: true });
          wfs.chmodSync(dir, PROCESS_DIR_MODE);
        }
      } catch (err) {
        void close();
        throw err;
      }

      const staged: Record<string, string> = {};
      let count = 0;
      const filesDir = join(dir, "files");

      const stageFrom = (value: unknown): Record<string, string> => {
        const fresh: Record<string, string> = {};
        const copies: Array<[source: string, target: string]> = [];
        const relatives: string[] = [];
        for (const candidate of descriptorPaths(value)) {
          const relative = safeSubPath(candidate, storageDir);
          if (
            relative === null ||
            relative === "" ||
            (grants !== undefined && !grants.has(relative)) ||
            staged[relative] !== undefined ||
            relatives.includes(relative)
          ) {
            continue;
          }

          const source = path.join(storageDir, relative);
          if (!isRegularFile(wfs, source)) continue;
          // A name of the engine's making, never the file's own: it lands in a folder it
          // does not control, and two granted files may share a name.
          copies.push([source, join(filesDir, `${(count += 1)}-${safeFilename(path.basename(relative))}`)]);
          relatives.push(relative);
        }
        if (copies.length === 0) return fresh;

        if (sandbox && lease) {
          // Root never writes here: the cell may already be running and could have put a
          // symlink where a copy is about to go. A helper that is the cell's uid copies.
          wfs.stageAs(lease.uid, sandbox.gid, filesDir, copies);
        } else {
          wfs.mkdirSync(filesDir, { recursive: true });
          wfs.chmodSync(filesDir, PROCESS_DIR_MODE);
          for (const [source, target] of copies) {
            wfs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
            wfs.chmodSync(target, 0o600);
          }
        }
        copies.forEach(([, target], index) => {
          staged[relatives[index]] = target;
          fresh[relatives[index]] = target;
        });
        return fresh;
      };

      const workspace: CellWorkspace = {
        dir,
        spawn,
        staged,
        stageFrom,
        writeScript(name: string, content: string): string {
          const target = join(dir, safeFilename(name));
          if (sandbox && lease) wfs.createFile(target, content, lease.uid, sandbox.gid, 0o600);
          else fs.writeFileSync(target, content, { flag: "wx", mode: 0o600 });
          return target;
        },
        dispose: close,
      };
      // A failure here must not leave the folder behind: nobody else knows its name.
      try {
        stageFrom(inputs);
      } catch (err) {
        void workspace.dispose();
        throw err;
      }
      return workspace;
    },
  };
}

function isRegularFile(wfs: WorkspaceFs, target: string): boolean {
  try {
    return wfs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** Deepest value looked through, and most nodes looked at: a descriptor is shallow and few. */
const MAX_DEPTH = 8;
const MAX_NODES = 5000;

/**
 * The `path` of every object in `value` that has a string one. It does not decide whether
 * a path may be read — that is the grants' job — it only finds what *might* be a file.
 */
function descriptorPaths(value: unknown): string[] {
  const found: string[] = [];
  let seen = 0;
  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== "object" || depth > MAX_DEPTH || (seen += 1) > MAX_NODES) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.path === "string") {
      found.push(record.path);
      return;
    }
    for (const item of Object.values(record)) walk(item, depth + 1);
  };
  walk(value, 0);
  return found;
}

/**
 * The host used when a runner is called without one (a unit test, a script): no sandbox, a
 * folder under the system temp. The engine's own runs always pass a host of the owner's.
 */
export function defaultCellHost(): CellHost {
  return createCellHost({});
}

/**
 * Makes the storage folder root's and closed (0700) when cells change uid, so that no cell
 * can enter it at all: what a cell may read is what the engine copied into its own folder.
 * The files inside keep their modes; it is the folder that is shut. Does nothing without a
 * sandbox, where there is no other user to shut it against.
 */
export function secureStorageRoot(
  config: SandboxConfig | undefined,
  storageDir: string,
  wfs: Pick<WorkspaceFs, "mkdirSync" | "chmodSync" | "chownSync"> = fs
): boolean {
  if (!config) return false;
  wfs.mkdirSync(storageDir, { recursive: true });
  wfs.chownSync(storageDir, 0, 0);
  wfs.chmodSync(storageDir, PROCESS_DIR_MODE);
  return true;
}

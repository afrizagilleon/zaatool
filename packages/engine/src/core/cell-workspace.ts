/**
 * Where a cell process lives, and what it is handed.
 *
 * Every cell process gets a folder of its own, made by the engine before the process starts
 * and removed when it is over (`<owner home>/cells/<128 random bits>/`). On Linux with the
 * sandbox on, the owner's home belongs to the owner's uid (0700) and so does the folder, so
 * no other owner's cell can enter either; elsewhere the same layout is made under the
 * system temp folder, owned by whoever runs the engine, so the code path is the one that
 * is tested.
 *
 * The storage folder is *not* readable by a cell. A cell reads only what the engine copied
 * into its folder: that is the whole file-input story (see {@link CellWorkspace.stageFrom}).
 * Nothing here touches the database: the owner's uid arrives already allocated.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { safeFilename, safeSubPath } from "./storage-paths.js";
import { STORAGE_DIR } from "./storage-root.js";
import { ownerHomePath, ownerSpawnIdentity, type CellSpawnIdentity, type SandboxConfig } from "./sandbox-identity.js";

/** The parts of `fs` this module changes, so a test can watch them on a machine that is not root. */
export interface WorkspaceFs {
  mkdirSync(dir: string, options: { recursive: true }): unknown;
  chmodSync(target: string, mode: number): void;
  chownSync(target: string, uid: number, gid: number): void;
  copyFileSync(source: string, target: string, mode?: number): void;
  statSync(target: string): { isFile(): boolean };
  rmSync(target: string, options: { recursive: true; force: true; maxRetries: number }): void;
}

const NO_IDENTITY: CellSpawnIdentity = { options: {}, env: {} };

export interface CellWorkspace {
  /** The process's own folder: its working directory, and the only place a JavaScript cell may read. */
  dir: string;
  /** Spawn options and environment for this process. */
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
  /** Removes the folder and everything in it. Safe to call twice. */
  dispose(): void;
}

export interface CellHost {
  /** What to spawn a process of this owner's with, also for the `uv` that resolves packages. */
  spawn: CellSpawnIdentity;
  /** A fresh folder for one cell process, with the granted files found in `inputs` already in it. */
  open(inputs?: unknown): CellWorkspace;
}

export interface CellHostOptions {
  /** Set when cells change uid: this owner's allocated uid under that sandbox. */
  sandbox?: { config: SandboxConfig; uid: number };
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

/** Mode of every folder a cell may be inside: nobody but the owner. */
const PRIVATE = 0o700;

/**
 * Makes `${home}/owners` (root, 0711: a cell can walk through it to its own folder but
 * cannot list who else has one) and the owner's own home with the folders a cell expects
 * (`tmp`, `.cache/uv`), all the owner's and 0700.
 */
export function prepareOwnerHome(config: SandboxConfig, uid: number, wfs: WorkspaceFs = fs): string {
  const owners = path.posix.join(config.home.replace(/\/+$/, ""), "owners");
  wfs.mkdirSync(owners, { recursive: true });
  wfs.chmodSync(owners, 0o711);

  const home = ownerHomePath(config, uid);
  for (const dir of [home, `${home}/tmp`, `${home}/.cache`, `${home}/.cache/uv`, `${home}/cells`]) {
    wfs.mkdirSync(dir, { recursive: true });
    wfs.chownSync(dir, uid, config.gid);
    wfs.chmodSync(dir, PRIVATE);
  }
  return home;
}

/** A folder name that is one safe segment whatever the owner id turns out to be. */
function keyOf(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "none";
}

export function createCellHost(options: CellHostOptions): CellHost {
  const wfs = options.fs ?? fs;
  const sandbox = options.sandbox;
  const grants = options.grants;
  const storageDir = options.storageDir ?? STORAGE_DIR;

  let home: string;
  let spawn: CellSpawnIdentity;
  let own: (target: string) => void;
  // The sandbox is Linux, and its paths are POSIX whatever machine a test runs on.
  const join = sandbox ? path.posix.join : path.join;

  if (sandbox) {
    home = prepareOwnerHome(sandbox.config, sandbox.uid, wfs);
    spawn = ownerSpawnIdentity(sandbox.config, sandbox.uid);
    own = (target) => wfs.chownSync(target, sandbox.uid, sandbox.config.gid);
  } else {
    home = path.join(
      options.tempRoot ?? path.join(os.tmpdir(), "zaatool-cells"),
      "owners",
      keyOf(options.ownerKey ?? "none")
    );
    spawn = NO_IDENTITY;
    own = () => undefined;
  }

  return {
    spawn,
    open(inputs?: unknown): CellWorkspace {
      const cells = join(home, "cells");
      wfs.mkdirSync(cells, { recursive: true });
      own(cells);
      const dir = join(cells, randomBytes(16).toString("hex"));
      wfs.mkdirSync(dir, { recursive: true });
      own(dir);
      wfs.chmodSync(dir, PRIVATE);

      const staged: Record<string, string> = {};
      let count = 0;
      let filesDir: string | undefined;

      const stageFrom = (value: unknown): Record<string, string> => {
        const fresh: Record<string, string> = {};
        for (const candidate of descriptorPaths(value)) {
          const relative = safeSubPath(candidate, storageDir);
          if (relative === null || relative === "" || (grants !== undefined && !grants.has(relative)) || staged[relative] !== undefined) continue;

          const source = path.join(storageDir, relative);
          if (!isRegularFile(wfs, source)) continue;

          if (filesDir === undefined) {
            filesDir = join(dir, "files");
            wfs.mkdirSync(filesDir, { recursive: true });
            own(filesDir);
            wfs.chmodSync(filesDir, PRIVATE);
          }
          // A name of the engine's making, never the file's own: it lands in a folder it
          // does not control, and two granted files may share a name.
          const target = join(filesDir, `${(count += 1)}-${safeFilename(path.basename(relative))}`);
          wfs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
          own(target);
          wfs.chmodSync(target, 0o600);
          staged[relative] = target;
          fresh[relative] = target;
        }
        return fresh;
      };

      const workspace: CellWorkspace = {
        dir,
        spawn,
        staged,
        stageFrom,
        dispose(): void {
          // Repeatable on purpose: the runners call it when they give up on a process and
          // again when it has really exited, and the second call removes what it wrote between.
          // Never throws: on Windows a process that has only just exited can still hold the
          // folder, and the call that follows its real exit removes it.
          try {
            wfs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
          } catch {
            // left for the next call
          }
        },
      };
      // A failure here must not leave the folder behind: nobody else knows its name.
      try {
        stageFrom(inputs);
      } catch (err) {
        workspace.dispose();
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

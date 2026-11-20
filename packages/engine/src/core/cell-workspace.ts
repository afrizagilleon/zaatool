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
import { ownerHomePath, ownerSpawnIdentity, type CellSpawnIdentity, type SandboxConfig } from "./sandbox-identity.js";

/** The parts of `fs` this module changes, so a test can watch them on a machine that is not root. */
export interface WorkspaceFs {
  mkdirSync(dir: string, options: { recursive: true }): unknown;
  chmodSync(target: string, mode: number): void;
  chownSync(target: string, uid: number, gid: number): void;
  rmSync(target: string, options: { recursive: true; force: true; maxRetries: number }): void;
}

const NO_IDENTITY: CellSpawnIdentity = { options: {}, env: {} };

export interface CellWorkspace {
  /** The process's own folder: its working directory, and the only place a JavaScript cell may read. */
  dir: string;
  /** Spawn options and environment for this process. */
  spawn: CellSpawnIdentity;
  /** Removes the folder and everything in it. Safe to call twice. */
  dispose(): void;
}

export interface CellHost {
  /** What to spawn a process of this owner's with, also for the `uv` that resolves packages. */
  spawn: CellSpawnIdentity;
  /** A fresh folder for one cell process. */
  open(): CellWorkspace;
}

export interface CellHostOptions {
  /** Set when cells change uid: this owner's allocated uid under that sandbox. */
  sandbox?: { config: SandboxConfig; uid: number };
  /** Without a sandbox: where folders go. Defaults to a folder under the system temp. */
  tempRoot?: string;
  /** Without a sandbox: names the owner's folder under `tempRoot` (any string; made safe). */
  ownerKey?: string;
  fs?: WorkspaceFs;
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
    open(): CellWorkspace {
      const cells = join(home, "cells");
      wfs.mkdirSync(cells, { recursive: true });
      own(cells);
      const dir = join(cells, randomBytes(16).toString("hex"));
      wfs.mkdirSync(dir, { recursive: true });
      own(dir);
      wfs.chmodSync(dir, PRIVATE);

      return {
        dir,
        spawn,
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
    },
  };
}

/**
 * The host used when a runner is called without one (a unit test, a script): no sandbox, a
 * folder under the system temp. The engine's own runs always pass a host of the owner's.
 */
export function defaultCellHost(): CellHost {
  return createCellHost({});
}

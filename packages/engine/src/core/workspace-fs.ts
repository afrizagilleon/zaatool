/**
 * The filesystem operations the engine performs, as root, on folders a cell may later write
 * to (C-01).
 *
 * A cell can plant a symlink anywhere it can write. Any operation done as root *by path*
 * (`chown`, `chmod`, `copyFile`, a recursive remove) that crosses such a path is then a
 * root-powered write to wherever the link points. The rule this file exists to keep:
 *
 *  - root changes owner or mode only of a folder or file that it has itself just made in a
 *    folder the cell cannot write to, and does so through the file descriptor it opened with
 *    `O_NOFOLLOW`, never through the path again;
 *  - root never writes into a folder the cell owns once the cell can be running: that is done
 *    by a helper that has first become the cell's own uid ({@link WorkspaceFs.stageAs}), for
 *    which a symlink is no more powerful than the cell already was;
 *  - root removes nothing the cell controls: the sweep helper does that as the cell's uid
 *    (see `uid-sweep`), and root only `rmdir`s the empty folder afterwards.
 *
 * The interface exists so a test can record these calls on a machine that is not root.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";

/** The part of `fs.Stats` the layout checks read. */
export interface StatLike {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  uid: number;
  gid: number;
  mode: number;
}

export interface WorkspaceFs {
  mkdirSync(dir: string, options?: { recursive?: boolean; mode?: number }): unknown;
  /** Like `fs.lstatSync` (never follows a symlink), but undefined when there is nothing there. */
  lstatSync(target: string): StatLike | undefined;
  /** By path: only for a folder root made itself, in a folder the cell cannot write to. */
  chmodSync(target: string, mode: number): void;
  chownSync(target: string, uid: number, gid: number): void;
  /** Hands over a folder root has just made: by descriptor, refusing a symlink. */
  adoptDirectory(dir: string, uid: number, gid: number, mode: number): void;
  /**
   * Creates a file that does not exist yet (never overwrites, never follows a link), owned by
   * `uid:gid`. Only for a folder no process of `uid` can be running in yet.
   */
  createFile(target: string, content: string, uid: number, gid: number, mode: number): void;
  /**
   * Copies each `[source, target]` as the process's own uid: the engine opens the sources,
   * and a helper that has become `uid` writes the targets (making `into` first). Throws when
   * a copy fails. For use while the process may already be running.
   */
  stageAs(uid: number, gid: number, into: string, files: Array<[source: string, target: string]>): void;
  /** Removes an empty folder; never recursive, so it cannot be led anywhere by a link. */
  rmdirSync(dir: string): void;
  statSync(target: string): { isFile(): boolean };
  copyFileSync(source: string, target: string, mode?: number): void;
  rmSync(target: string, options: { recursive: true; force: true; maxRetries: number }): void;
}

const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_DIRECTORY } = fs.constants;

/** Runs as the process's uid. `n` walks the descriptors the engine passed in, from 3. */
const STAGE_SCRIPT = 'umask 077; into=$1; shift; mkdir -p "$into" || exit 1; n=3; for t; do /bin/cat <&$n >"$t" || exit 1; n=$((n+1)); done';

/** Longest a staging helper may take: a granted file is copied, not built. */
const STAGE_TIMEOUT_MS = 60_000;

export const nodeWorkspaceFs: WorkspaceFs = {
  mkdirSync: (dir, options) => fs.mkdirSync(dir, options),
  lstatSync: (target) => fs.lstatSync(target, { throwIfNoEntry: false }),
  chmodSync: (target, mode) => fs.chmodSync(target, mode),
  chownSync: (target, uid, gid) => fs.chownSync(target, uid, gid),

  adoptDirectory(dir, uid, gid, mode): void {
    const fd = fs.openSync(dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    try {
      fs.fchownSync(fd, uid, gid);
      fs.fchmodSync(fd, mode);
    } finally {
      fs.closeSync(fd);
    }
  },

  createFile(target, content, uid, gid, mode): void {
    const fd = fs.openSync(target, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
    try {
      fs.writeSync(fd, content);
      fs.fchownSync(fd, uid, gid);
      fs.fchmodSync(fd, mode);
    } finally {
      fs.closeSync(fd);
    }
  },

  stageAs(uid, gid, into, files): void {
    const opened: number[] = [];
    try {
      for (const [source] of files) {
        const fd = fs.openSync(source, O_RDONLY | O_NOFOLLOW);
        opened.push(fd);
        if (!fs.fstatSync(fd).isFile()) throw new Error(`${source} is not a regular file`);
      }
      const result = spawnSync(
        "/bin/sh",
        ["-c", STAGE_SCRIPT, "sh", into, ...files.map(([, target]) => target)],
        {
          uid,
          gid,
          cwd: "/",
          env: { PATH: "/usr/bin:/bin" },
          stdio: ["ignore", "ignore", "ignore", ...opened],
          timeout: STAGE_TIMEOUT_MS,
        }
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`copying the input files into the cell's folder failed (exit ${result.status})`);
    } finally {
      for (const fd of opened) fs.closeSync(fd);
    }
  },

  rmdirSync: (dir) => fs.rmdirSync(dir),
  statSync: (target) => fs.statSync(target),
  copyFileSync: (source, target, mode) => fs.copyFileSync(source, target, mode),
  rmSync: (target, options) => fs.rmSync(target, options),
};

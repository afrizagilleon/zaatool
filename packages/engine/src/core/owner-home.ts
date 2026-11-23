/**
 * An owner's folders on Linux with the sandbox on, and who may do what in them (S-16, C-01).
 *
 * Every cell process of an owner runs as a uid of its own and in the owner's group. What the
 * cells of one owner share is therefore shared through that *group*, and what is theirs alone
 * is theirs through the uid:
 *
 *     owners/                  root         0711   a cell can reach its own owner's folder, not list others
 *       <gid>/                 root:<gid>   0750   the group can enter it, nobody can add or rename in it
 *         tmp/                 root:<gid>   2770   TMPDIR  shared by the owner's cells (setgid: files keep the group)
 *         home/                root:<gid>   2770   HOME    shared
 *         .cache/              root:<gid>   0750
 *           uv/                root:<gid>   2770   the package cache, shared so a package is installed once
 *         cells/               root:<gid>   0710   enter-only: nobody can list the other processes' folders
 *           <random>/          <uid>:<gid>  0700   one cell process's own folder, made per process
 *
 * Everything on the left of the cells' reach is **root's and not writable by the group**. That
 * is the C-01 fix: a cell can write *into* `tmp`, `home` and `.cache/uv`, but it cannot
 * replace `tmp`, `.cache` or `cells` themselves with a symlink, so the engine (root) can
 * check and change those entries by path without ever being led somewhere else. The engine
 * never changes anything *inside* the shared folders.
 *
 * Cells create files with `umask 007` (see `cell-limits`), so what one cell writes into a
 * shared folder is group-readable and group-writable for the owner's next cell, and closed to
 * everyone else.
 */
import path from "node:path";
import { trimEndChars } from "./linear-text.js";
import { ownerHomePath, type SandboxConfig } from "./sandbox-identity.js";
import type { StatLike, WorkspaceFs } from "./workspace-fs.js";

/** Mode of a folder the group may enter but not change. */
const ENTER = 0o750;
/** Mode of a folder the group shares: read, write, and new files keep the group (setgid). */
const SHARED = 0o2770;
/** Mode of `cells`: the group can pass through it to its own process folder, not list it. */
const PASS_THROUGH = 0o710;
/** Mode of a process folder: its uid only. */
export const PROCESS_DIR_MODE = 0o700;

/** Thrown when a folder that must be root's is not: the message says what to do. */
export class OwnerHomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerHomeError";
  }
}

/**
 * Makes sure `dir` is a plain folder of root's with this group and mode, making it when it
 * does not exist. Only ever used on entries that live in a folder the group cannot write to,
 * so nothing can be swapped between the check and the change; the `lstat` is the belt to that
 * brace and refuses a symlink or a folder that is not root's.
 */
function ensureRootDir(wfs: WorkspaceFs, dir: string, gid: number, mode: number): void {
  let info: StatLike | undefined = wfs.lstatSync(dir);
  if (info === undefined) {
    wfs.mkdirSync(dir, { mode: 0o700 });
    info = wfs.lstatSync(dir);
  }
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) {
    throw new OwnerHomeError(`${dir} is not a plain folder, so it will not be used for cells.`);
  }
  if (info.uid !== 0) {
    throw new OwnerHomeError(
      `${dir} belongs to uid ${info.uid}, not root: it was made before cells ran as one user per process ` +
        "and has not been converted. Restart the engine so it converts it (see owner-home-migration), " +
        "or remove the folder."
    );
  }
  if (info.gid !== gid) wfs.chownSync(dir, 0, gid);
  if ((info.mode & 0o7777) !== mode) wfs.chmodSync(dir, mode);
}

/**
 * Makes `${home}/owners` (root, 0711) and the owner's folders as drawn above, and returns the
 * owner's folder. Safe to call on every run: it only creates what is missing and corrects
 * what has drifted.
 */
export function prepareOwnerHome(config: SandboxConfig, ownerGid: number, wfs: WorkspaceFs): string {
  const owners = path.posix.join(trimEndChars(config.home, "/"), "owners");
  wfs.mkdirSync(owners, { recursive: true });
  // 0711 is the isolation, not a gap: execute lets a cell reach its own owner's folder (when
  // that is group-readable to it), and the missing read bit keeps it from listing who else has
  // one. 0700 here would stop every cell.
  ensureRootDir(wfs, owners, 0, 0o711); // NOSONAR: traverse-only parent of the per-owner folders

  const home = ownerHomePath(config, ownerGid);
  ensureRootDir(wfs, home, ownerGid, ENTER);
  ensureRootDir(wfs, `${home}/tmp`, ownerGid, SHARED);
  ensureRootDir(wfs, `${home}/home`, ownerGid, SHARED);
  ensureRootDir(wfs, `${home}/.cache`, ownerGid, ENTER);
  ensureRootDir(wfs, `${home}/.cache/uv`, ownerGid, SHARED);
  ensureRootDir(wfs, `${home}/cells`, ownerGid, PASS_THROUGH); // NOSONAR: enter-only, see the table above
  return home;
}

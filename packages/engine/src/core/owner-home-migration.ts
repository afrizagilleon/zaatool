/**
 * Brings an installation that ran cells as one uid per owner over to one gid per owner and
 * one uid per process (S-16), and clears what a stopped engine left behind.
 *
 * Before, `${home}/owners/<K>` belonged to *uid* K (the owner's uid, `users.sandbox_uid`) and
 * was 0700. That number is now the owner's *gid* (the column is kept; it is the same range),
 * and the folder must be root's with the owner's group (see `owner-home`). So, once, at start:
 *
 *  - every folder and file of an old home that belongs to the old uid is re-owned to
 *    `root:<K>`, with the owner's permission bits copied to the group and everything for
 *    "others" removed, so the owner's package cache and files stay in use rather than being
 *    thrown away;
 *  - loose entries the old layout kept directly in the home (it was HOME) move into `home/`;
 *  - the folders of cell processes the previous engine did not get to remove are deleted.
 *
 * This runs before the engine serves anything, so no cell is running and nothing can swap a
 * path under it (the same reason it is safe to chown by path here and nowhere else). It never
 * follows a symlink (`lchown`, and a link's mode is not touched), and it only re-owns what
 * belongs to the old uid, so a hard link a cell made to a file of root's is left alone.
 *
 * A home that cannot be converted is not served: `prepareOwnerHome` refuses it by name.
 */
import fs from "node:fs";
import path from "node:path";
import { trimEndChars } from "./linear-text.js";
import { ownerHomePath, type SandboxConfig } from "./sandbox-identity.js";
import type { StatLike } from "./workspace-fs.js";

export interface MigrationEntry {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** The parts of `fs` this module uses, so a test can run it on an in-memory tree. */
export interface MigrationFs {
  readdirSync(dir: string): MigrationEntry[];
  mkdirSync(dir: string): void;
  lstatSync(target: string): StatLike | undefined;
  lchownSync(target: string, uid: number, gid: number): void;
  chmodSync(target: string, mode: number): void;
  renameSync(from: string, to: string): void;
  rmSync(target: string, options: { recursive: true; force: true }): void;
}

export const nodeMigrationFs: MigrationFs = {
  readdirSync: (dir) => fs.readdirSync(dir, { withFileTypes: true }),
  mkdirSync: (dir) => void fs.mkdirSync(dir),
  lstatSync: (target) => fs.lstatSync(target, { throwIfNoEntry: false }),
  lchownSync: (target, uid, gid) => fs.lchownSync(target, uid, gid),
  chmodSync: (target, mode) => fs.chmodSync(target, mode),
  renameSync: (from, to) => fs.renameSync(from, to),
  rmSync: (target, options) => fs.rmSync(target, options),
};

export interface MigrationReport {
  /** Homes that belonged to an old uid and now belong to root with the owner's group. */
  converted: number[];
  /** Homes that could not be converted, with the reason. */
  problems: string[];
  /** Process folders removed from `cells/`. */
  clearedProcessFolders: number;
}

/** The folders of the new layout: anything else directly in an old home is moved into `home/`. */
const LAYOUT = new Set(["tmp", "home", ".cache", "cells"]);

/**
 * Re-owns `target` and everything under it that belongs to `oldUid`: `root:<gid>`, the owner's
 * permission bits copied to the group, "others" closed. Returns how many entries it changed.
 *
 * A folder is changed after what is in it. The start looks at the top folder's owner to decide
 * whether a home still needs converting, so a crash half way must leave the top folder as it
 * was, and the next start finishes the job.
 */
function convertTree(wfs: MigrationFs, target: string, oldUid: number, gid: number): number {
  const info = wfs.lstatSync(target);
  if (info === undefined || info.uid !== oldUid) return 0;
  let changed = 1;
  if (info.isDirectory() && !info.isSymbolicLink()) {
    for (const entry of wfs.readdirSync(target)) {
      changed += convertTree(wfs, path.posix.join(target, entry.name), oldUid, gid);
    }
  }
  wfs.lchownSync(target, 0, gid);
  if (!info.isSymbolicLink()) {
    const owner = info.mode & 0o700;
    wfs.chmodSync(target, (info.mode & 0o7000) | owner | (owner >> 3));
  }
  return changed;
}

function removeContents(wfs: MigrationFs, dir: string): number {
  let removed = 0;
  let entries: MigrationEntry[];
  try {
    entries = wfs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    wfs.rmSync(path.posix.join(dir, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

export function migrateOwnerHomes(config: SandboxConfig, wfs: MigrationFs = nodeMigrationFs): MigrationReport {
  const report: MigrationReport = { converted: [], problems: [], clearedProcessFolders: 0 };
  const owners = `${trimEndChars(config.home, "/")}/owners`;

  let names: MigrationEntry[];
  try {
    names = wfs.readdirSync(owners);
  } catch {
    return report; // nothing has ever run here
  }

  for (const entry of names) {
    if (!/^\d+$/.test(entry.name)) continue;
    const gid = Number(entry.name);
    const home = ownerHomePath(config, gid);
    const info = wfs.lstatSync(home);
    if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) {
      report.problems.push(`${home} is not a plain folder and was left alone.`);
      continue;
    }

    try {
      if (info.uid !== 0) {
        if (info.uid !== gid) {
          report.problems.push(
            `${home} belongs to uid ${info.uid}, not the owner uid ${gid} it was named for, and was left alone.`
          );
          continue;
        }
        convertTree(wfs, home, gid, gid);
        const into = `${home}/home`;
        if (wfs.lstatSync(into) === undefined) {
          wfs.mkdirSync(into);
          wfs.lchownSync(into, 0, gid);
        }
        for (const loose of wfs.readdirSync(home)) {
          if (LAYOUT.has(loose.name) || wfs.lstatSync(`${into}/${loose.name}`) !== undefined) continue;
          wfs.renameSync(`${home}/${loose.name}`, `${into}/${loose.name}`);
        }
        report.converted.push(gid);
      }
      report.clearedProcessFolders += removeContents(wfs, `${home}/cells`);
    } catch (err: unknown) {
      report.problems.push(`${home} could not be converted: ${(err as Error).message}`);
    }
  }
  return report;
}

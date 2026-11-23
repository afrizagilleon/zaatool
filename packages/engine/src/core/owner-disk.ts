/**
 * A disk quota per notebook owner, and the housekeeping that keeps it reachable.
 *
 * `RLIMIT_FSIZE` bounds one file; nothing bounds how many an owner's cells leave behind in
 * their `tmp` and package cache, and the disk is shared by every owner (S-14). Before an
 * owner's cell starts, the size of the owner's folder (`<SANDBOX_HOME>/owners/<key>`) is
 * compared with `MAX_OWNER_DISK_MB`; over it, the cell is refused with a message instead.
 *
 * Measuring a big folder (a package cache with pandas in it is tens of thousands of files) is
 * not free, so a measurement is reused for a short time, concurrent askers share one walk, and
 * the walk stops as soon as it passes the limit. When an owner has had no cell for a while
 * their `tmp` is emptied, and a package cache past its share is pruned (`uv cache prune`) and,
 * if that is not enough, emptied: a cache is only a cache. Both as the owner, not as root.
 *
 * The engine does this as root, inside a folder a hostile cell has been writing to, so it only
 * ever *measures* (`lstat`: a symlink is counted as the link itself and never entered). Removing
 * what is in there is done by a process with a cell's identity, never by root (see
 * `owner-clean` and C-01).
 */
import fs from "node:fs";
import path from "node:path";
import { maxOwnerDiskBytes } from "../config.js";
import type { CellHost } from "./cell-workspace.js";
import { cleanAsOwner, clearDirContents, type CleanJob } from "./owner-clean.js";

export { clearDirContents };

const MB = 1024 * 1024;
/** How long a measurement is believed. A cell that fills the disk within this is stopped by the next check. */
export const USAGE_TTL_MS = 5_000;
/** How long an owner must have had no cell before their `tmp` is emptied. */
export const IDLE_MS = 5 * 60_000;
const STAT_BATCH = 64;

export interface Measure {
  /** Disk bytes counted. A lower bound when `complete` is false. */
  bytes: number;
  /** False when the walk gave up part-way because `stopAfter` was passed; `bytes` then only says "more than that". */
  complete: boolean;
}

/**
 * Disk usage of `root`, counting what is on disk (allocated blocks) once per hard link group.
 * Never enters a symlink, never leaves the device of `root` (a mount inside it is not the
 * owner's folder), and stops once `stopAfter` bytes were counted.
 */
export async function measureDir(root: string, stopAfter = Infinity): Promise<Measure> {
  let rootStat: fs.Stats;
  try {
    rootStat = await fs.promises.lstat(root);
  } catch {
    return { bytes: 0, complete: true };
  }
  if (!rootStat.isDirectory()) return { bytes: 0, complete: true };

  const seen = new Set<string>();
  const stack = [root];
  const sizeOf = (st: fs.Stats): number => (st.blocks ? st.blocks * 512 : st.size);
  let bytes = sizeOf(rootStat);

  while (stack.length > 0) {
    if (bytes > stopAfter) return { bytes, complete: false };
    const dir = stack.pop() as string;
    let names: string[];
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      continue; // vanished or unreadable: nothing it holds can be counted
    }
    for (let i = 0; i < names.length; i += STAT_BATCH) {
      const stats = await Promise.all(
        names.slice(i, i + STAT_BATCH).map((name) =>
          fs.promises.lstat(path.join(dir, name)).then(
            (st) => ({ name, st }),
            () => null
          )
        )
      );
      for (const entry of stats) {
        if (!entry) continue;
        const { name, st } = entry;
        if (st.isDirectory()) {
          if (st.dev !== rootStat.dev) continue;
          stack.push(path.join(dir, name));
        } else if (st.nlink > 1) {
          const key = `${st.dev}:${st.ino}`;
          if (seen.has(key)) continue;
          seen.add(key);
        }
        bytes += sizeOf(st);
      }
    }
  }
  return { bytes, complete: true };
}

export interface OwnerDiskOptions {
  limitBytes: () => number;
  ttlMs?: number;
  idleMs?: number;
  now?: () => number;
  /** Does a clean-up job as the owner (see `owner-clean`). Replaceable by a test. */
  clean?: (host: CellHost, job: CleanJob) => Promise<unknown>;
}

interface OwnerState {
  host: CellHost;
  active: number;
  usage?: { bytes: number; at: number };
  measuring?: Promise<number>;
  idle?: NodeJS.Timeout;
  cleaning?: Promise<void>;
}

export interface OwnerDisk {
  /**
   * Runs `run` unless the owner is over quota, in which case `refused(message)` is returned
   * instead and nothing starts. Also counts `run` as the owner being busy.
   */
  guard<T>(host: CellHost | undefined, run: () => Promise<T>, refused: (message: string) => T): Promise<T>;
  /** Housekeeping for an owner now (what runs after `idleMs`). Exposed for tests. */
  tidy(host: CellHost): Promise<void>;
}

export function refusalMessage(usedBytes: number, limitBytes: number): string {
  return (
    `Not enough disk space: the files your notebooks keep on this server (temporary files and ` +
    `package cache) use ${Math.ceil(usedBytes / MB)} MB, over the ${Math.floor(limitBytes / MB)} MB allowed per ` +
    `account. They are cleared automatically a few minutes after your last cell finishes, so try ` +
    `again shortly; if it keeps happening, delete the files your cells write to their temp folder, ` +
    `or ask the administrator to raise MAX_OWNER_DISK_MB.`
  );
}

export function createOwnerDisk(options: OwnerDiskOptions): OwnerDisk {
  const ttl = options.ttlMs ?? USAGE_TTL_MS;
  const idleMs = options.idleMs ?? IDLE_MS;
  const now = options.now ?? Date.now;
  const clean = options.clean ?? cleanAsOwner;
  const owners = new Map<string, OwnerState>();

  function stateOf(host: CellHost): OwnerState {
    let state = owners.get(host.home);
    if (!state) {
      state = { host, active: 0 };
      owners.set(host.home, state);
    }
    return state;
  }

  function usageOf(state: OwnerState, limit: number): Promise<number> {
    if (state.usage && now() - state.usage.at < ttl) return Promise.resolve(state.usage.bytes);
    state.measuring ??= measureDir(state.host.home, limit)
      .then((m) => {
        state.usage = { bytes: m.bytes, at: now() };
        return m.bytes;
      })
      .finally(() => {
        state.measuring = undefined;
      });
    return state.measuring;
  }

  async function tidy(host: CellHost): Promise<void> {
    const home = host.home;
    await clean(host, "tmp");
    // Where the owner's cache is, by the layout in `owner-home`; without the sandbox there is none.
    const cache = path.join(home, ".cache", "uv");
    const share = Math.floor(options.limitBytes() / 2);
    if ((await measureDir(cache, share)).bytes > share) {
      await clean(host, "uv-prune");
      if ((await measureDir(cache, share)).bytes > share) await clean(host, "uv-cache");
    }
    const state = owners.get(home);
    if (state) state.usage = undefined;
  }

  function scheduleTidy(state: OwnerState): void {
    clearTimeout(state.idle);
    state.idle = setTimeout(() => {
      state.idle = undefined;
      if (state.active > 0) return;
      state.cleaning = tidy(state.host)
        .catch(() => undefined)
        .finally(() => {
          state.cleaning = undefined;
          if (state.active === 0) owners.delete(state.host.home);
        });
    }, idleMs);
    state.idle.unref();
  }

  async function guard<T>(
    host: CellHost | undefined,
    run: () => Promise<T>,
    refused: (message: string) => T
  ): Promise<T> {
    if (!host) return run();
    const state = stateOf(host);
    // Never start while the housekeeping is deleting in the owner's folder.
    while (state.cleaning) await state.cleaning;
    clearTimeout(state.idle);
    state.idle = undefined;
    state.active += 1;
    try {
      const limit = options.limitBytes();
      const used = await usageOf(state, limit).catch(() => 0);
      if (used > limit) return refused(refusalMessage(used, limit));
      return await run();
    } finally {
      state.active -= 1;
      if (state.active === 0) scheduleTidy(state);
    }
  }

  return { guard, tidy };
}

/** The quota in force, from `MAX_OWNER_DISK_MB`. */
export const ownerDisk: OwnerDisk = createOwnerDisk({ limitBytes: maxOwnerDiskBytes });

/** `ownerDisk.guard`, so a runner needs one import and one call. */
export function withOwnerDisk<T>(
  host: CellHost | undefined,
  run: () => Promise<T>,
  refused: (message: string) => T
): Promise<T> {
  return ownerDisk.guard(host, run, refused);
}

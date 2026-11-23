/**
 * The pool of one-off uids cell processes run as, and the sweep that cleans one up (S-16).
 *
 * Killing a cell's process group is not enough on Linux: a child that calls `setsid()` (or
 * double-forks) leaves the group, and a child that outlives its parent is no longer reachable
 * from the engine's pid at all. The one handle that always reaches whatever a cell left
 * behind is its uid. So every cell process (JavaScript, Python, the `uv` that resolves its
 * packages) is given a uid of its own, and:
 *
 *  - when the process is over, a tiny helper is spawned *as that uid* that kills everything
 *    of that uid (`kill(-1)`, which on Linux never includes the caller and, being that uid,
 *    can touch nothing of anyone else's, root's or the engine's), waits until nothing is
 *    left, and removes what the uid left in the folders everybody can write to
 *    (`/dev/shm`, `/tmp`, `/var/tmp`) and in the process's own folder. Everything it deletes it
 *    deletes as that uid, so a symlink the cell planted cannot turn the clean-up into a
 *    root-powered delete;
 *  - only then is the uid free again. A uid is never reused before its sweep has succeeded,
 *    and the next uid is always the one after the last handed out, so a uid is not handed out
 *    again until the whole range has been used. A sweep that cannot be confirmed retires the
 *    uid for the life of this engine instead of risking it.
 *
 * Nothing here is held across a run: the pool is only a list of which numbers are taken.
 * The decision of who needs a uid, and the folders, belong to `cell-workspace`.
 */
import { spawn } from "node:child_process";

export interface SweepTarget {
  uid: number;
  /** The group the helper runs as: the owner's, so it can remove what its files' group owns. */
  gid: number;
  /** The process's own folder: its contents are removed (the folder itself is the caller's). */
  dir?: string;
}

/** Sweeps one uid. Resolves true only when nothing of that uid is left running; never rejects. */
export type Sweeper = (target: SweepTarget) => Promise<boolean>;

/** How long a sweep helper may take before it is given up on. */
const SWEEP_TIMEOUT_MS = 8000;

/**
 * What the helper runs, as the uid it cleans. Plain JavaScript run with `node -e`, so it needs
 * no file the uid could not read. `process.argv[1]` is the folder to empty ("" for none).
 *
 * It loops because a fork bomb can start a child between `kill(-1)` walking the process table
 * and returning; it stops when `/proc` shows no live process of this uid but itself. A
 * zombie does not count: it is only waiting for its parent (the engine) to collect it.
 */
export const SWEEP_SCRIPT = String.raw`
const fs = require("fs");
const me = process.getuid();
const self = process.pid;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function alive() {
  let names = [];
  try { names = fs.readdirSync("/proc"); } catch { return 0; }
  let count = 0;
  for (const name of names) {
    if (!/^[0-9]+$/.test(name) || Number(name) === self) continue;
    try {
      if (fs.statSync("/proc/" + name).uid !== me) continue;
      const stat = fs.readFileSync("/proc/" + name + "/stat", "latin1");
      const state = stat[stat.lastIndexOf(")") + 2];
      if (state !== "Z" && state !== "X") count += 1;
    } catch { /* gone while we looked */ }
  }
  return count;
}

let clean = false;
for (let round = 0; round < 40 && !clean; round += 1) {
  try { process.kill(-1, "SIGKILL"); } catch { /* nothing to signal */ }
  clean = alive() === 0;
  if (!clean) sleep(25);
}

function remove(target) {
  let info;
  try { info = fs.lstatSync(target); } catch { return; }
  if (info.isDirectory()) {
    try { fs.chmodSync(target, 0o700); } catch { /* ours, but not always changeable */ }
    let names = [];
    try { names = fs.readdirSync(target); } catch { /* unreadable: left */ }
    for (const name of names) remove(target + "/" + name);
    try { fs.rmdirSync(target); } catch { /* not empty, or not ours */ }
  } else {
    try { fs.unlinkSync(target); } catch { /* not ours */ }
  }
}

const dir = process.argv[1] || "";
if (dir !== "") {
  try { for (const name of fs.readdirSync(dir)) remove(dir + "/" + name); } catch { /* gone already */ }
}
for (const shared of ["/dev/shm", "/tmp", "/var/tmp"]) {
  let names = [];
  try { names = fs.readdirSync(shared); } catch { continue; }
  for (const name of names) {
    try { if (fs.lstatSync(shared + "/" + name).uid === me) remove(shared + "/" + name); } catch { /* gone */ }
  }
}
process.exit(clean ? 0 : 2);
`;

/** The real sweeper: node, as the uid, running {@link SWEEP_SCRIPT}. */
export const spawnSweep: Sweeper = ({ uid, gid, dir }) =>
  new Promise<boolean>((resolve) => {
    try {
      const helper = spawn(process.execPath, ["-e", SWEEP_SCRIPT, dir ?? ""], {
        uid,
        gid,
        // The engine's folder may not be readable by the uid, and the helper needs nothing.
        cwd: "/",
        env: {},
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        helper.kill("SIGKILL");
        resolve(false);
      }, SWEEP_TIMEOUT_MS);
      timer.unref();
      helper.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      helper.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });

/** Every uid in the range is taken by a running (or retired) process. Says what to change. */
export class UidPoolExhaustedError extends Error {
  constructor(count: number) {
    super(
      `All ${count} sandbox process ids are in use, so this cell cannot start. ` +
        "Raise SANDBOX_UID_COUNT, or run fewer cells at once."
    );
    this.name = "UidPoolExhaustedError";
  }
}

export interface UidLease {
  readonly uid: number;
  /**
   * Gives the uid back: sweeps it (and empties `dir`), and frees it only if the sweep is
   * confirmed. Safe to call twice; both calls get the same promise. Never rejects.
   */
  release(dir?: string): Promise<void>;
}

export interface UidPool {
  /** A uid nobody is using, for a process whose group is `gid`. Throws when none is free. */
  lease(gid: number): UidLease;
  /** How many uids are leased right now, or still being swept. */
  inUse(): number;
  /** How many uids were retired because a sweep could not be confirmed. */
  retired(): number;
}

export interface UidPoolOptions {
  base: number;
  count: number;
  sweeper: Sweeper;
  /** Where in the range to start (an offset). Random by default, so a restart is no pattern. */
  start?: number;
  /** Extra sweeps tried when one is not confirmed. */
  retries?: number;
  retryDelayMs?: number;
  /** Told when a uid is retired. */
  onProblem?: (message: string) => void;
}

export function createUidPool(options: UidPoolOptions): UidPool {
  const { base, count, sweeper } = options;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const onProblem = options.onProblem ?? ((message: string) => console.warn(`⚠️  ${message}`));

  // Leased, being swept, or retired. A uid leaves it only after a confirmed sweep.
  const taken = new Set<number>();
  const retired = new Set<number>();
  let cursor = (options.start ?? Math.floor(Math.random() * count)) % count;

  async function sweepUntilClean(target: SweepTarget): Promise<boolean> {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0 && retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      if (await sweeper(target).catch(() => false)) return true;
    }
    return false;
  }

  return {
    lease(gid: number): UidLease {
      let uid: number | undefined;
      // Always on from the uid after the last one handed out: a uid comes round again only
      // when every other one has been used.
      for (let step = 0; step < count; step += 1) {
        const candidate = base + ((cursor + step) % count);
        if (!taken.has(candidate)) {
          uid = candidate;
          cursor = (candidate - base + 1) % count;
          break;
        }
      }
      if (uid === undefined) throw new UidPoolExhaustedError(count);
      const leased = uid;
      taken.add(leased);

      let done: Promise<void> | undefined;
      return {
        uid: leased,
        release(dir?: string): Promise<void> {
          done ??= (async () => {
            if (await sweepUntilClean({ uid: leased, gid, dir })) {
              taken.delete(leased);
              return;
            }
            retired.add(leased);
            onProblem(
              `Sandbox uid ${leased} could not be swept clean and is retired until the engine restarts ` +
                "(a process of it may still be running)."
            );
          })();
          return done;
        },
      };
    },
    inUse: () => taken.size - retired.size,
    retired: () => retired.size,
  };
}

const pools = new Map<string, UidPool>();

/** The pool of this engine for `config`'s range: one per range, made on first use. */
export function sharedUidPool(config: { uidBase: number; uidCount: number }): UidPool {
  const key = `${config.uidBase}:${config.uidCount}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = createUidPool({ base: config.uidBase, count: config.uidCount, sweeper: spawnSweep });
    pools.set(key, pool);
  }
  return pool;
}

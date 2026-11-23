/**
 * Cleans up after the last running process of a cell owner.
 *
 * Killing a cell's process group is not enough on Linux: a child that calls `setsid()` (or
 * double-forks) leaves the group, and a child that outlives its parent is no longer reachable
 * from the engine's pid at all. Every cell of an owner runs as the owner's uid (FX-20), so the
 * one handle that always reaches whatever such a cell left behind is that uid.
 *
 * This module counts the processes an owner has running (cells, and the `uv` that resolves
 * their packages). When the count falls to zero it spawns a tiny helper *as that uid* that
 * sends SIGKILL to "every process I may signal" (`kill(-1)`). On Linux that never includes the
 * caller, and being the owner's uid it can touch nothing of anyone else's, root's or the
 * engine's. It is skipped whenever there is no uid to switch to (Windows, no sandbox).
 *
 * Two races matter and are closed here:
 *  - a new process of the same owner must not start while a sweep is running, or the sweep
 *    would kill it: {@link UidLedger.acquire} waits for the sweep to end;
 *  - the sweep must not start while a process is running: it only starts at count zero, and
 *    the check and the start happen in one synchronous step.
 */
import { spawn } from "node:child_process";

/** The part of a spawn identity the sweep needs: `CellSpawnIdentity.options`. */
export interface SweepTarget {
  uid?: number;
  gid?: number;
}

/** Runs the sweep for one owner. Must resolve (not reject) when it is over. */
export type Sweeper = (target: { uid: number; gid?: number }) => Promise<void>;

/** How long a sweep helper may take before it is given up on. */
const SWEEP_TIMEOUT_MS = 5000;

/**
 * The real sweeper: node, as the owner, killing everything of that owner. Failures are
 * swallowed on purpose: the sweep is a safety net on a path that is already finishing a run,
 * and nothing the caller could do about a failure would be better than carrying on.
 */
export const spawnKillAll: Sweeper = ({ uid, gid }) =>
  new Promise<void>((resolve) => {
    try {
      const helper = spawn(process.execPath, ["-e", "try{process.kill(-1,'SIGKILL')}catch{}"], {
        uid,
        gid,
        // The engine's folder may not be readable by the owner, and the helper needs nothing.
        cwd: "/",
        env: {},
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        helper.kill("SIGKILL");
        resolve();
      }, SWEEP_TIMEOUT_MS);
      timer.unref();
      helper.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
      helper.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    } catch {
      resolve();
    }
  });

export interface UidLedger {
  /**
   * Registers one running process of `target.uid`. Waits first if a sweep of that uid is in
   * progress. Returns the release to call once the process is over (calling it twice does
   * nothing); the last release starts the sweep.
   */
  acquire(target: { uid: number; gid?: number }): Promise<() => void>;
  /** Runs `run` while holding a lease, or just runs it when there is no uid to sweep. */
  withLease<T>(target: SweepTarget, run: () => Promise<T>): Promise<T>;
}

export function createUidLedger(sweeper: Sweeper): UidLedger {
  const active = new Map<number, number>();
  const sweeping = new Map<number, Promise<void>>();

  async function acquire(target: { uid: number; gid?: number }): Promise<() => void> {
    const { uid } = target;
    // Loop: after one sweep ends, another may already have started before this resumes.
    for (let sweep = sweeping.get(uid); sweep; sweep = sweeping.get(uid)) await sweep;
    active.set(uid, (active.get(uid) ?? 0) + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (active.get(uid) ?? 1) - 1;
      if (left > 0) {
        active.set(uid, left);
        return;
      }
      active.delete(uid);
      const sweep = sweeper(target)
        .catch(() => undefined)
        .finally(() => sweeping.delete(uid));
      sweeping.set(uid, sweep);
    };
  }

  async function withLease<T>(target: SweepTarget, run: () => Promise<T>): Promise<T> {
    if (!sweepable(target)) return run();
    const release = await acquire({ uid: target.uid, gid: target.gid });
    try {
      return await run();
    } finally {
      release();
    }
  }

  return { acquire, withLease };
}

/** Never root, never without a uid: sweeping as uid 0 would kill the engine itself. */
function sweepable(target: SweepTarget): target is { uid: number; gid?: number } {
  return (
    process.platform !== "win32" &&
    typeof target.uid === "number" &&
    Number.isInteger(target.uid) &&
    target.uid > 0
  );
}

/** The ledger the runners use, sweeping for real. */
export const uidLedger: UidLedger = createUidLedger(spawnKillAll);

/** `uidLedger.withLease`, so a runner needs one import and one line. */
export function withUidLease<T>(target: SweepTarget, run: () => Promise<T>): Promise<T> {
  return uidLedger.withLease(target, run);
}

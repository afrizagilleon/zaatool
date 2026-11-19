import { spawn, type ChildProcess } from "node:child_process";

/**
 * Spawn options that make a child killable as a whole tree on POSIX: `detached` puts it
 * at the head of its own process group (no `unref`, stdio untouched, so the engine still
 * waits on it and reads its pipes as before). Windows needs nothing here; `taskkill /T`
 * walks the tree by parent PID.
 */
export const TREE_SPAWN_OPTIONS: { detached: boolean } = {
  detached: process.platform !== "win32",
};

/**
 * Kills a child process AND everything it started.
 *
 * `proc.kill()` only reaches the direct child. For `uv run ... python` that is `uv`,
 * leaving `python` (and anything a cell spawned) running, burning CPU after the engine
 * reported a timeout.
 *
 *  - Windows: `taskkill /PID <pid> /T /F`, run without a shell. Fire-and-forget with
 *    errors swallowed: this runs on a path that is already failing the run, the process
 *    may legitimately be gone already (taskkill then exits non-zero), and nothing the
 *    caller could do about a failure would be better than carrying on.
 *  - POSIX: SIGKILL to the negative PID, i.e. the whole process group. The child must
 *    have been spawned with `TREE_SPAWN_OPTIONS` for it to lead a group.
 *
 * Falls back to killing the direct child if the tree kill cannot be attempted.
 * Safe to call more than once.
 */
export function killTree(proc: ChildProcess): void {
  const pid = proc.pid;
  if (pid === undefined) {
    proc.kill("SIGKILL");
    return;
  }

  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => proc.kill("SIGKILL"));
    } catch {
      proc.kill("SIGKILL");
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

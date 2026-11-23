/**
 * Makes the kernel's out-of-memory killer pick a cell before it picks the engine (S-17).
 *
 * The container's memory limit is shared by the engine and every cell. When it is reached the
 * kernel kills the process with the highest `oom_score`, and the engine, being the biggest
 * long-lived process, is a likely victim: one greedy cell would then take every other run
 * down with it. Writing 1000 (the maximum) to a cell's `/proc/<pid>/oom_score_adj` makes the
 * cell the first choice.
 *
 * Two facts make this more than one line:
 *  - any process may *raise* its own score, but only one with `CAP_SYS_RESOURCE` may lower it
 *    below what a privileged writer set (the kernel records the value as a floor, `oom_score_adj_min`).
 *    So the engine writes it, not the cell, and with the capability (compose adds it) a cell
 *    cannot undo it. Without the capability the write still succeeds, but the floor is not
 *    recorded, and a cell can write 0 back: {@link oomGuardWarning} says so at start;
 *  - children inherit the value across fork and exec, so setting it on the pid the engine
 *    spawned (which `prlimit`, `sh` and `uv` replace with the real program, same pid) covers
 *    everything the cell starts.
 *
 * It must be written after the spawn and before the cell is handed any work, which is why the
 * runners call it between those two. A failure is reported and ignored: a cell that runs
 * without the protection is better than a run that does not.
 */
import fs from "node:fs";

/** `CAP_SYS_RESOURCE` is capability number 24; `CapEff` in `/proc/self/status` is a hex mask. */
const CAP_SYS_RESOURCE_BIT = 24n;

/**
 * What to tell the operator at start when the engine cannot lock a cell's score: Linux only,
 * from the text of `/proc/self/status`. Undefined when it can, or when this is not Linux.
 */
export function oomGuardWarning(
  platform: NodeJS.Platform = process.platform,
  readStatus: () => string = () => fs.readFileSync("/proc/self/status", "utf8")
): string | undefined {
  if (platform !== "linux") return undefined;
  let mask: bigint;
  try {
    const hex = /^CapEff:\s*([0-9a-fA-F]+)/m.exec(readStatus())?.[1];
    if (hex === undefined) return undefined;
    mask = BigInt(`0x${hex}`);
  } catch {
    return undefined;
  }
  if ((mask >> CAP_SYS_RESOURCE_BIT) & 1n) return undefined;
  return (
    "The engine does not have CAP_SYS_RESOURCE, so it cannot stop a cell from lowering its own " +
    "oom_score_adj: when the container runs out of memory the kernel may kill the engine instead " +
    "of the cell. Add cap_add: [SYS_RESOURCE] to the engine container (the compose file does)."
  );
}

/** The highest score: this process is killed first. */
export const CELL_OOM_SCORE_ADJ = 1000;

export type OomWriter = (file: string, value: string) => void;

/**
 * Locks `pid`'s OOM score adjustment at {@link CELL_OOM_SCORE_ADJ}. Returns undefined on
 * success, or what went wrong. Only Linux has the file; elsewhere it returns undefined without
 * doing anything.
 */
export function lockOomScore(
  pid: number | undefined,
  platform: NodeJS.Platform = process.platform,
  write: OomWriter = (file, value) => fs.writeFileSync(file, value)
): string | undefined {
  if (platform !== "linux" || pid === undefined) return undefined;
  try {
    write(`/proc/${pid}/oom_score_adj`, String(CELL_OOM_SCORE_ADJ));
    return undefined;
  } catch (err: unknown) {
    return `could not set oom_score_adj=${CELL_OOM_SCORE_ADJ} on cell process ${pid}: ${(err as Error).message}`;
  }
}

let reported = false;

/**
 * {@link lockOomScore} for a runner: reports a failure once per engine run, on the console,
 * because the same cause (a missing capability) would otherwise repeat for every cell.
 */
export function guardCellFromOom(pid: number | undefined, applies: boolean): void {
  if (!applies) return;
  const problem = lockOomScore(pid);
  if (problem !== undefined && !reported) {
    reported = true;
    console.warn(
      `⚠️  ${problem}. Add cap_add: [SYS_RESOURCE] to the engine, or one greedy cell can get the engine killed.`
    );
  }
}

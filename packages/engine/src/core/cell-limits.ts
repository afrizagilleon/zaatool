/**
 * Hard resource limits for a cell process on Linux (S-03, S-05).
 *
 * The container's `mem_limit` and `pids_limit` are shared by the engine and every cell, so
 * on their own a fork bomb or a huge allocation by one owner can still take the engine
 * down. These limits are per process (memory, file size) and per uid (process count, which
 * is therefore per owner since FX-20), and they are set by `prlimit` *before* the cell's
 * own code is executed. A non-root process cannot raise a hard limit, so nothing the cell
 * does can undo them.
 *
 * Done with `prlimit` in front of the command rather than `resource.setrlimit` inside the
 * Python wrapper because it covers the JavaScript cells as well, and because `prlimit`
 * replaces itself with the command (`execvp`): the pid stays the one the engine spawned and
 * stays the head of its process group, so `killTree` is unaffected.
 *
 * The memory limit is `RLIMIT_DATA`, not `RLIMIT_AS`. Since Linux 4.7 it counts every
 * private writable mapping (heap, anonymous mmap, thread stacks, `Buffer`s, numpy arrays)
 * and nothing else, so it measures what a cell really consumes. `RLIMIT_AS` also counts
 * address space that is only reserved, which is a lot for V8 and for OpenBLAS.
 *
 * Pure functions of their inputs, like `sandbox-identity`, so they can be tested anywhere.
 */
import { existsSync } from "node:fs";

/** Where util-linux puts it on Debian. Absolute so `PATH` never decides what runs. */
export const PRLIMIT_PATH = "/usr/bin/prlimit";

const MB = 1024 * 1024;

/**
 * What a bare Node process already holds in `RLIMIT_DATA` terms before any code runs: V8
 * reserves about 575 MB of private address space at start, whatever `--max-old-space-size`
 * is (measured on node:24-bookworm-slim, identical at 128 MB and at 2 GB). Without this
 * allowance a limit equal to the heap cap would stop Node from starting.
 */
export const JS_RUNTIME_RESERVE_MB = 640;

/**
 * Threads the numeric libraries may start in a Python cell. OpenBLAS keeps about 40 MB of
 * private buffers per thread and starts one per core of the *host* (a container's `cpus`
 * quota is not visible to it): 16 cores cost 760 MB before the notebook has done anything,
 * which no sensible per-cell limit survives. Four is plenty for a container that gets two
 * CPUs by default, and a cell that wants more can set the variable itself before importing.
 */
const PYTHON_NUMERIC_THREADS = "4";
const THREAD_VARS = ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"];

export interface CellLimits {
  /** Megabytes of private memory a cell may hold; for JS, on top of {@link JS_RUNTIME_RESERVE_MB}. */
  memoryMb: number;
  /** Processes and threads the owner's uid may have, all of its running cells together. */
  processes: number;
  /** Largest single file, in megabytes, a cell may write. */
  fileMb: number;
}

export type CellKind = "js" | "python";

/** Arguments for `prlimit` that apply `limits` to a cell of `kind`. */
export function prlimitArgs(limits: CellLimits, kind: CellKind): string[] {
  const data = (kind === "js" ? limits.memoryMb + JS_RUNTIME_RESERVE_MB : limits.memoryMb) * MB;
  return [
    `--data=${data}`,
    `--nproc=${limits.processes}`,
    `--fsize=${limits.fileMb * MB}`,
    "--core=0",
    "--",
  ];
}

export interface Command {
  bin: string;
  args: string[];
}

/**
 * `command` run under the limits, or unchanged when they do not apply. They apply when the
 * cell is dropped to an owner's uid (see `sandbox-identity`): that is the production shape,
 * and without it the process is the engine's own user, which a developer's laptop is.
 *
 * `numericThreads` is for Python cells only (see {@link PYTHON_NUMERIC_THREADS}).
 */
export function limitedCommand(
  command: Command,
  kind: CellKind,
  limits: CellLimits,
  applies: boolean,
  prlimit: string = PRLIMIT_PATH
): Command {
  if (!applies) return command;
  const env = kind === "python" ? ["/usr/bin/env", ...THREAD_VARS.map((name) => `${name}=${PYTHON_NUMERIC_THREADS}`)] : [];
  return {
    bin: prlimit,
    args: [...prlimitArgs(limits, kind), ...env, command.bin, ...command.args],
  };
}

/** Whether `prlimit` is installed, for the startup check. */
export function prlimitAvailable(path: string = PRLIMIT_PATH): boolean {
  return existsSync(path);
}

/**
 * Node's own words when an allocation is refused ("Failed to allocate memory") say nothing
 * about *why*, and the person reading a failed run is not the one who set the limit. A
 * message that is that refusal gets the limit named; anything else is returned as it came.
 */
export function explainMemoryRefusal(message: string, memoryMb: number): string {
  if (!/Failed to allocate memory|Array buffer allocation failed/i.test(message)) return message;
  return `${message} (the cell ran out of memory; limit ${memoryMb} MB beyond what Node itself needs)`;
}

/**
 * Hard resource limits for a cell process on Linux (S-03, S-05).
 *
 * The container's `mem_limit` and `pids_limit` are shared by the engine and every cell, so
 * on their own a fork bomb or a huge allocation by one owner can still take the engine
 * down. These limits are per process (memory, file size) and per uid (process count, which
 * is therefore per cell process, since every process has a uid of its own: S-16), and they
 * are set by `prlimit` *before* the cell's own code is executed. A non-root process cannot raise a hard limit, so nothing the cell
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
 * The same chain also sets `umask 007` (a `sh` that `exec`s the command, so the pid is still
 * the same). Every cell of an owner is a different uid in the owner's group, and what one
 * writes into the owner's shared folders (the `uv` cache above all) has to be group-writable
 * for the next: with the usual 022 a second cell cannot enter a cache directory the first
 * created ("Permission denied" in `sdists-v9`), and with 077 nobody could.
 *
 * Pure functions of their inputs, like `sandbox-identity`, so they can be tested anywhere.
 */
import { existsSync } from "node:fs";

/** Where util-linux puts it on Debian. Absolute so `PATH` never decides what runs. */
export const PRLIMIT_PATH = "/usr/bin/prlimit";
const SH_PATH = "/bin/sh";

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
  /** Processes and threads the cell's uid may have: the cell and everything it starts. */
  processes: number;
  /** Largest single file, in megabytes, a cell may write. */
  fileMb: number;
}

/**
 * `install` is `uv` fetching, building and unpacking a notebook's packages: its own, looser
 * limits (see `installLimits` in config), because installing a large wheel is not the
 * notebook's own memory and `uv` itself runs many threads.
 */
export type CellKind = "js" | "python" | "install";

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

/** Group-writable, nothing for others: see the note at the top. `exec` keeps the pid. */
const UMASK_SCRIPT = 'umask 007; exec "$@"';

export interface Command {
  bin: string;
  args: string[];
}

/**
 * `command` run under the limits, or unchanged when they do not apply. They apply when the
 * cell is dropped to a uid of its own (see `sandbox-identity`): that is the production shape,
 * and without it the process is the engine's own user, which a developer's laptop is.
 *
 * Python cells get their numeric thread caps (see {@link PYTHON_NUMERIC_THREADS}). `umask`
 * is off only for a command that already runs under another `limitedCommand` that has it
 * (the interpreter `uv` runs).
 */
export function limitedCommand(
  command: Command,
  kind: CellKind,
  limits: CellLimits,
  applies: boolean,
  prlimit: string = PRLIMIT_PATH,
  options: { umask?: boolean } = {}
): Command {
  if (!applies) return command;
  const env = kind === "python" ? ["/usr/bin/env", ...THREAD_VARS.map((name) => `${name}=${PYTHON_NUMERIC_THREADS}`)] : [];
  const inner = options.umask === false ? [command.bin, ...command.args] : [SH_PATH, "-c", UMASK_SCRIPT, "sh", command.bin, ...command.args];
  return {
    bin: prlimit,
    args: [...prlimitArgs(limits, kind), ...env, ...inner],
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

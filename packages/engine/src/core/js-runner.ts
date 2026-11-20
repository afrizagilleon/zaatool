import { spawn, type Serializable } from "node:child_process";
import path from "path";
import { fileURLToPath } from "url";
import { buildSandboxEnv } from "./sandbox-env.js";
import { killTree, TREE_SPAWN_OPTIONS } from "./kill-tree.js";
import type { NotebookCaller } from "./notebook-call.js";
import type { FileWriter } from "./notebook-files.js";
import { abortMessage } from "./run-abort.js";
import { cellIdentity, maxCellMemoryMb } from "../config.js";
import { STORAGE_DIR } from "./storage-root.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The one script a cell process runs. Plain JavaScript, so the child needs no loader. */
const CELL_HOST = path.join(__dirname, "cell-host.mjs");

/**
 * The folders a cell may read besides the host script and storage: the engine's own
 * `node_modules` and the workspace root's. pnpm keeps a package's files under the root's
 * `node_modules/.pnpm` and links them from the engine's, so a declared package needs both.
 * What a cell can `require` is still the declared list (the host enforces it); this only
 * lets those packages load.
 */
const ENGINE_DIR = path.resolve(__dirname, "../..");
const PACKAGE_DIRS = [
  path.join(ENGINE_DIR, "node_modules"),
  path.resolve(ENGINE_DIR, "../../node_modules"),
];

/** Tail of a child's stderr kept for a crash report, so a runaway one cannot fill memory. */
const STDERR_LIMIT = 8 * 1024;

export interface RunResult {
  output?: Record<string, unknown>;
  logs: { level: string; msg: string }[];
  error?: string;
  ms: number;
}

/**
 * Runs one JavaScript cell in its own node process, under node's permission model.
 *
 * Cells used to run in a worker thread: same process as the engine, same filesystem, and
 * a scoped `require` that `module._load` walked around. Now the cell is a child that can
 * read its host script, the storage folder and the declared packages, can write nothing,
 * and cannot start a process, a thread or an addon — the runtime refuses, whatever the
 * cell's code does. Its heap is capped, and it gets its own environment.
 *
 * The network is NOT restricted: node's permission model has no switch for it.
 */
export function runJsNode(
  code: string,
  inputs: Record<string, unknown>,
  timeoutMs = 5000,
  onLog?: (level: string, msg: string) => void,
  secrets: Record<string, string> = {},
  inputsSchema: any[] = [],
  onCall?: NotebookCaller,
  onFile?: FileWriter,
  packages: string[] = [],
  /** Aborted by the run's deadline or a cancel; the cell then ends with the abort reason. */
  signal?: AbortSignal
): Promise<RunResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const logs: RunResult["logs"] = [];
    const memoryMb = maxCellMemoryMb();
    // On Linux with SANDBOX_UID set the child is not root and has its own HOME and TMPDIR.
    const identity = cellIdentity();

    // `process.execPath`, not `process.execArgv`: the engine may be running under `tsx`,
    // and the cell must not inherit its loader (or any other flag of the engine's).
    const proc = spawn(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${CELL_HOST}`,
        `--allow-fs-read=${STORAGE_DIR}`,
        ...PACKAGE_DIRS.map((dir) => `--allow-fs-read=${dir}`),
        `--max-old-space-size=${memoryMb}`,
        CELL_HOST,
      ],
      {
        // The cell gets its own environment rather than a copy of the engine's, so user
        // code cannot read the server's credentials.
        env: { ...buildSandboxEnv(secrets), ...identity.env },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
        ...TREE_SPAWN_OPTIONS,
        ...identity.options,
      }
    );

    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    let exited = false;
    let stderr = "";

    const finish = (result: Omit<RunResult, "logs" | "ms">, opts: { graceful?: boolean } = {}): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (!exited) {
        if (opts.graceful) {
          // The cell announced its own end and is exiting; this only covers one that hangs.
          setTimeout(() => {
            if (!exited) killTree(proc);
          }, 2000).unref();
        } else {
          killTree(proc);
        }
      }
      resolve({ ...result, logs, ms: Date.now() - startTime });
    };

    // The clock measures how long this cell holds a process, so it is paused while a
    // nested notebook runs: that time is spent in another run with timeouts of its
    // own, and charging it here would make a cell's limit depend on its callees.
    const startTimer = (): void => {
      timer = setTimeout(() => {
        finish({ error: `Timeout after ${timeoutMs}ms` });
      }, timeoutMs);
    };
    const pauseTimer = (): void => clearTimeout(timer);

    // Unlike the timer, this is never paused: it is the run's own deadline (or a cancel),
    // which has to reach a cell that is parked on a nested call or a file write too.
    const onAbort = (): void => {
      finish({ error: abortMessage(signal!) });
    };

    startTimer();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    const post = (message: Serializable): void => {
      if (proc.connected) proc.send(message, () => undefined);
    };

    // Whatever the cell writes to the raw streams (not through console) is a log line.
    let stdoutBuffer = "";
    proc.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newline = stdoutBuffer.indexOf("\n");
      while (newline !== -1) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        newline = stdoutBuffer.indexOf("\n");
        if (line.trim() !== "") {
          logs.push({ level: "info", msg: line });
          onLog?.("info", line);
        }
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.toString();
    });

    proc.on("message", (msg: any) => {
      if (msg?.type === "log") {
        logs.push({ level: msg.level, msg: msg.msg });
        onLog?.(msg.level, msg.msg);
        return;
      }

      if (msg?.type === "call") {
        if (!onCall) {
          post({
            type: "call:result",
            id: msg.id,
            ok: false,
            error: "Calling another notebook is not available here",
          });
          return;
        }

        pauseTimer();
        void onCall({ notebook: msg.notebook, input: msg.input })
          .then((value) => ({ ok: true as const, value }))
          .catch((err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }))
          .then((outcome) => {
            if (settled) return;
            startTimer();
            post({ type: "call:result", id: msg.id, ...outcome });
          });
        return;
      }

      if (msg?.type === "file:write") {
        if (!onFile) {
          post({
            type: "file:result",
            id: msg.id,
            ok: false,
            error: "Writing a file is not available here",
          });
          return;
        }

        // Paused for the same reason a call pauses it: the time goes on this engine's
        // disk rather than in the cell, and charging it here would make a cell's limit
        // depend on how large its own output happens to be.
        pauseTimer();
        void onFile({ name: msg.name, data: msg.data, encoding: msg.encoding })
          .then((value) => ({ ok: true as const, value }))
          .catch((err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }))
          .then((outcome) => {
            if (settled) return;
            startTimer();
            post({ type: "file:result", id: msg.id, ...outcome });
          });
        return;
      }

      if (msg?.type === "done") {
        finish({ output: msg.output }, { graceful: true });
      } else if (msg?.type === "error") {
        finish({ error: msg.error }, { graceful: true });
      }
    });

    proc.on("error", (err) => {
      finish({ error: err.message });
    });

    // A cell that ended without saying so was killed from outside or crashed; the usual
    // cause is the heap cap. The engine reports it as the cell's failure and carries on.
    proc.on("close", (code, sig) => {
      exited = true;
      setImmediate(() => {
        if (settled) return;
        const tail = stderr.trim();
        if (/heap out of memory|Allocation failed|ERR_WORKER_OUT_OF_MEMORY/i.test(tail)) {
          return finish({ error: `The cell ran out of memory (limit ${memoryMb} MB).` });
        }
        const reason = sig ? `signal ${sig}` : `exit code ${code}`;
        const lastLine = tail.split("\n").filter((line) => line.trim() !== "").pop();
        finish({
          error: `The cell's process ended unexpectedly (${reason})${lastLine ? `: ${lastLine.trim()}` : ""}`,
        });
      });
    });

    // Code, inputs and flags go over the channel, never argv or env: those are visible to
    // anything that can list processes, and env is the cell's own to read.
    post({
      code,
      inputs,
      inputsSchema,
      canCall: Boolean(onCall),
      canWriteFile: Boolean(onFile),
      packages,
      storageRoot: STORAGE_DIR,
    });
  });
}

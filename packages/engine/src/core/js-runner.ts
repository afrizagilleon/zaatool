import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";
import { buildSandboxEnv } from "./sandbox-env.js";
import type { NotebookCaller } from "./notebook-call.js";
import type { FileWriter } from "./notebook-files.js";
import { STORAGE_DIR } from "../services/storage.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RunResult {
  output?: Record<string, unknown>;
  logs: { level: string; msg: string }[];
  error?: string;
  ms: number;
}

export function runJsNode(
  code: string,
  inputs: Record<string, unknown>,
  timeoutMs = 5000,
  onLog?: (level: string, msg: string) => void,
  secrets: Record<string, string> = {},
  inputsSchema: any[] = [],
  onCall?: NotebookCaller,
  onFile?: FileWriter,
  packages: string[] = []
): Promise<RunResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const logs: RunResult["logs"] = [];

    // Dynamically resolve filename extension (.ts during tsx watch, .js when compiled/dist)
    const ext = path.extname(import.meta.url) || ".js";
    const workerPath = path.join(__dirname, `worker-boot${ext}`);

    const worker = new Worker(
      workerPath,
      {
        workerData: {
          code,
          inputs,
          inputsSchema,
          canCall: Boolean(onCall),
          canWriteFile: Boolean(onFile),
          packages,
          storageRoot: STORAGE_DIR,
        },
        // The worker gets its own environment rather than a copy of the
        // engine's, so user code cannot read the server's credentials.
        env: buildSandboxEnv(secrets),
        execArgv: process.execArgv,
      }
    );

    let timer: NodeJS.Timeout | undefined;
    let settled = false;

    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };

    // The clock measures how long this cell holds a worker, so it is paused while a
    // nested notebook runs: that time is spent in another run with timeouts of its
    // own, and charging it here would make a cell's limit depend on its callees.
    const startTimer = (): void => {
      timer = setTimeout(() => {
        finish({ error: `Timeout after ${timeoutMs}ms`, logs, ms: Date.now() - startTime });
      }, timeoutMs);
    };
    const pauseTimer = (): void => clearTimeout(timer);

    startTimer();

    worker.on("message", (msg) => {
      if (msg.type === "log") {
        logs.push({ level: msg.level, msg: msg.msg });
        onLog?.(msg.level, msg.msg);
        return;
      }

      if (msg.type === "call") {
        if (!onCall) {
          worker.postMessage({
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
            worker.postMessage({ type: "call:result", id: msg.id, ...outcome });
          });
        return;
      }

      if (msg.type === "file:write") {
        if (!onFile) {
          worker.postMessage({
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
            worker.postMessage({ type: "file:result", id: msg.id, ...outcome });
          });
        return;
      }

      if (msg.type === "done") {
        finish({ output: msg.output, logs, ms: Date.now() - startTime });
      } else if (msg.type === "error") {
        finish({ error: msg.error, logs, ms: Date.now() - startTime });
      }
    });

    worker.on("error", (err) => {
      finish({ error: err.message, logs, ms: Date.now() - startTime });
    });
  });
}

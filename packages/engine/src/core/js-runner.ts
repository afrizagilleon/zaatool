import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";

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
  onLog?: (level: string, msg: string) => void
): Promise<RunResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const logs: RunResult["logs"] = [];

    // Dynamically resolve filename extension (.ts during tsx watch, .js when compiled/dist)
    const ext = path.extname(import.meta.url) || ".js";
    const workerPath = path.join(__dirname, `worker-boot${ext}`);

    const worker = new Worker(
      workerPath,
      { workerData: { code, inputs } }
    );

    // timeout, force kill
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ error: `Timeout after ${timeoutMs}ms`, logs, ms: Date.now() - startTime });
    }, timeoutMs);

    worker.on("message", (msg) => {
      if (msg.type === "log") {
        logs.push({ level: msg.level, msg: msg.msg });
        onLog?.(msg.level, msg.msg);
      } else if (msg.type === "done") {
        clearTimeout(timer);
        resolve({ output: msg.output, logs, ms: Date.now() - startTime });
      } else if (msg.type === "error") {
        clearTimeout(timer);
        resolve({ error: msg.error, logs, ms: Date.now() - startTime });
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timer);
      resolve({ error: err.message, logs, ms: Date.now() - startTime });
    });
  });
}

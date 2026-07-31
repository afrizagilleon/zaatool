import { workerData, parentPort } from "worker_threads";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// Secrets arrive through the worker's `env` option (see js-runner), not through
// workerData — the worker's process.env is already scoped to this node.
const { code, inputs, inputsSchema, canCall } = workerData;

// catch console.log from user's code → send as event log
const originalLog = console.log;
console.log = (...args) => {
  parentPort?.postMessage({ type: "log", level: "info", msg: args.join(" ") });
};
console.error = (...args) => {
  parentPort?.postMessage({ type: "log", level: "error", msg: args.join(" ") });
};

/**
 * `notebooks.run(...)` — the one way out of this worker.
 *
 * The engine answers on the same port the logs go out on; a call is just a message
 * with an id, and the promise for it resolves when the reply carrying that id arrives.
 */
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
let nextCallId = 0;

parentPort?.on("message", (msg) => {
  if (msg?.type !== "call:result") return;
  const waiting = pending.get(msg.id);
  if (!waiting) return;
  pending.delete(msg.id);
  if (msg.ok) waiting.resolve(msg.value);
  else waiting.reject(new Error(msg.error));
});

const notebooks = {
  run(notebook: string, input?: Record<string, unknown>): Promise<unknown> {
    if (!canCall) {
      return Promise.reject(new Error("Calling another notebook is not available here"));
    }
    if (typeof notebook !== "string" || notebook.trim() === "") {
      return Promise.reject(new Error("notebooks.run needs a notebook id or name"));
    }
    return new Promise((resolve, reject) => {
      const id = ++nextCallId;
      pending.set(id, { resolve, reject });
      parentPort?.postMessage({ type: "call", id, notebook, input });
    });
  },
};

(async () => {
  try {
    const wrappersPath = import.meta.url
      .replace("worker-boot.ts", "code-wrappers.ts")
      .replace("worker-boot.js", "code-wrappers.js");

    const { Table, FileObject, ImageObject } = await import(wrappersPath);

    // Wrap inputs based on schema type
    const wrappedInputs = { ...inputs };
    if (inputsSchema && Array.isArray(inputsSchema)) {
      for (const field of inputsSchema) {
        const key = field.name;
        const value = inputs[key];
        if (value !== undefined && value !== null) {
          if (field.type === "table") {
            wrappedInputs[key] = new Table(value as any[]);
          } else if (field.type === "file") {
            wrappedInputs[key] = new FileObject(value);
          } else if (field.type === "image") {
            wrappedInputs[key] = new ImageObject(value);
          }
        }
      }
    }

    // wrap user's code in an async function
    const fn = new Function(
      "inputs",
      "require",
      "Table",
      "FileObject",
      "ImageObject",
      "notebooks",
      `"use strict"; return (async () => { ${code} })()`,
    );
    const output = await fn(wrappedInputs, require, Table, FileObject, ImageObject, notebooks);
    const cleanOutput = output !== undefined ? JSON.parse(JSON.stringify(output)) : undefined;
    parentPort?.postMessage({ type: "done", output: cleanOutput });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    parentPort?.postMessage({
      type: "error",
      error: error.message,
      stack: error.stack,
    });
  } finally {
    console.log = originalLog;
  }
})();

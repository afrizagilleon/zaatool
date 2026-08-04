import { workerData, parentPort } from "worker_threads";
import { createRequire } from "module";

const nodeRequire = createRequire(import.meta.url);
// Secrets arrive through the worker's `env` option (see js-runner), not through
// workerData — the worker's process.env is already scoped to this node.
const { code, inputs, inputsSchema, canCall, canWriteFile, packages } = workerData;

/**
 * `require`, narrowed to what the notebook declared.
 *
 * It used to resolve out of the engine's own `node_modules`, which meant a cell could
 * `require('pg')` and open a client to the database this application runs on. Nothing
 * about writing a notebook should reach that far, and nothing announced that it could.
 *
 * Node's own built-ins stay: a cell that wants `crypto` or `fs` is doing ordinary work,
 * and the process it runs in is already the boundary. What is gone is *the engine's
 * dependency tree by accident*.
 */
const allowed = new Set<string>(Array.isArray(packages) ? packages : []);

const scopedRequire = (specifier: string): unknown => {
  const name = String(specifier ?? "");
  const bare = name.replace(/^node:/, "").split("/")[0];

  // A path is not a package, and there is nothing on this disk a cell should be reading
  // by path — the notebook is the unit, not the filesystem around it.
  if (name.startsWith(".") || name.startsWith("/")) {
    throw new Error(`require("${name}") is not available: a cell cannot load files by path.`);
  }

  if (allowed.has(bare) || isBuiltin(bare)) return nodeRequire(name);

  throw new Error(
    `require("${name}") is not available. Declare it in the notebook's \`packages:\` list, ` +
      "or use one of node's built-in modules."
  );
};

function isBuiltin(name: string): boolean {
  // `module.builtinModules` is the list node itself keeps, so this never drifts.
  const { builtinModules } = nodeRequire("module") as { builtinModules: string[] };
  return builtinModules.includes(name);
}

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

/** Replies to `notebooks.run` and to `files.write` arrive the same way, on the same port. */
const fileWrites = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
let nextFileId = 0;

parentPort?.on("message", (msg) => {
  const waiting =
    msg?.type === "call:result"
      ? pending.get(msg.id)
      : msg?.type === "file:result"
        ? fileWrites.get(msg.id)
        : undefined;
  if (!waiting) return;

  if (msg.type === "call:result") pending.delete(msg.id);
  else fileWrites.delete(msg.id);

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

/**
 * `files.write(name, data)` — how a cell keeps something.
 *
 * `data` may be a string, a Buffer, a Uint8Array or an ArrayBuffer, because a cell that
 * has just produced a PNG should not have to know which of those it is holding. Text is
 * sent as text and everything else as base64; the engine writes it and answers with the
 * path and a signed link, which is exactly what `render: image` and `render: file` want.
 */
const files = {
  write(name: string, data: unknown, encoding?: "utf8" | "base64"): Promise<unknown> {
    if (!canWriteFile) {
      return Promise.reject(new Error("Writing a file is not available here"));
    }

    let payload: string;
    let sent: "utf8" | "base64";

    if (typeof data === "string") {
      payload = data;
      sent = encoding ?? "utf8";
    } else if (data instanceof ArrayBuffer) {
      payload = Buffer.from(new Uint8Array(data)).toString("base64");
      sent = "base64";
    } else if (ArrayBuffer.isView(data)) {
      payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
      sent = "base64";
    } else {
      return Promise.reject(
        new Error("files.write needs a string, a Buffer, a Uint8Array or an ArrayBuffer")
      );
    }

    return new Promise((resolve, reject) => {
      const id = ++nextFileId;
      fileWrites.set(id, { resolve, reject });
      parentPort?.postMessage({ type: "file:write", id, name, data: payload, encoding: sent });
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
      "files",
      `"use strict"; return (async () => { ${code} })()`,
    );
    const output = await fn(
      wrappedInputs,
      scopedRequire,
      Table,
      FileObject,
      ImageObject,
      notebooks,
      files
    );
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

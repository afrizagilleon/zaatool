// The process a JavaScript cell runs in.
//
// Plain JavaScript on purpose: this file is the entry point of a child process that the
// engine starts under node's permission model (see js-runner.ts), and that child has no
// `tsx` loader and no business needing one. It is also the whole of what the cell can
// reach on this disk besides its own folder and the declared packages, so it stays
// small and self-contained.
//
// It does what `worker-boot.ts` and `code-wrappers.ts` did while cells ran in a worker
// thread: a scoped `require`, `Table` / `FileObject` / `ImageObject`, `notebooks.run`,
// `files.write`, console forwarding and the `done` / `error` messages. The protocol is
// the same; it travels over the IPC channel (`process.send` / `process.on("message")`)
// instead of a worker's `parentPort`.
//
// Everything the cell must not do — read the engine's source, write a file, start a
// process or a thread, load a native addon — is refused by the runtime itself, not by
// anything in this file. The checks here are the friendly error that comes first.

import fs from "node:fs";
import nodePath from "node:path";
import { createRequire, builtinModules } from "node:module";

const nodeRequire = createRequire(import.meta.url);

/**
 * Built-ins that fail with a readable sentence instead of the runtime's access error.
 * The permission model is what actually stops them (and stops `module._load` and every
 * other way round this list); this list is only the early, friendly message.
 */
export const DENIED_BUILTINS = new Set([
  "child_process",
  "worker_threads",
  "cluster",
  "vm",
  "inspector",
  "repl",
]);

/**
 * The files the engine copied into this process's own folder: storage path (as the engine
 * normalised it) to the copy. A FileObject reads only through this; it never trusts an
 * `absolute_path` that arrived as data, and it has no storage folder to look in.
 */
const staged = new Map();

export class Table {
  constructor(rows) {
    this.rows = Array.isArray(rows) ? rows : [];
  }
  getRows() {
    return this.rows;
  }
  getRow(index) {
    return this.rows[index] || null;
  }
  getHeaders() {
    if (this.rows.length === 0) return [];
    return Object.keys(this.rows[0]);
  }
  getColumn(columnKey) {
    return this.rows.map((row) => row[columnKey]);
  }
  getCell(rowIndex, columnKey) {
    const row = this.getRow(rowIndex);
    return row ? row[columnKey] : null;
  }
  filter(callback) {
    return new Table(this.rows.filter((row, index, rows) => callback(row, index, rows)));
  }
  map(callback) {
    return this.rows.map((row, index, rows) => callback(row, index, rows));
  }
  count() {
    return this.rows.length;
  }
  toJSON() {
    return this.rows;
  }
}

export class FileObject {
  constructor(fileData) {
    this.name = fileData?.name || "";
    this.path = fileData?.path || "";
    this.url = fileData?.url || "";
    this.absolute_path = this.#derive(fileData?.path);
  }

  #derive(rel) {
    if (typeof rel !== "string" || rel.trim() === "") return "";
    const key = nodePath.posix.normalize(rel.trim().replace(/\\/g, "/").replace(/^\/+/, ""));
    return staged.get(key) ?? "";
  }

  readAsText() {
    if (!this.absolute_path || !fs.existsSync(this.absolute_path)) return "";
    return fs.readFileSync(this.absolute_path, "utf-8");
  }
  readAsBase64() {
    if (!this.absolute_path || !fs.existsSync(this.absolute_path)) return "";
    return fs.readFileSync(this.absolute_path, "base64");
  }
  readAsBuffer() {
    if (!this.absolute_path || !fs.existsSync(this.absolute_path)) return null;
    return fs.readFileSync(this.absolute_path);
  }
  exists() {
    return !!this.absolute_path && fs.existsSync(this.absolute_path);
  }

  /**
   * `absolute_path` is deliberately absent.
   *
   * It exists so this object can read the file, and it names a folder on the server. A
   * cell that returns the file it was given would otherwise put the engine's disk layout
   * into a page, a webhook's reply and an agent's transcript.
   */
  toJSON() {
    return { name: this.name, path: this.path, url: this.url };
  }
}

export class ImageObject extends FileObject {
  constructor(imageData) {
    if (typeof imageData === "string") {
      super({ path: imageData, url: imageData, name: imageData.split("/").pop() });
    } else {
      super(imageData);
    }
  }
  toDataUri(mimeType = "image/jpeg") {
    const base64 = this.readAsBase64();
    if (!base64) return "";
    return `data:${mimeType};base64,${base64}`;
  }
}

const send = (msg, callback) => process.send(msg, undefined, undefined, callback);

// catch console.log from user's code → send as event log
console.log = (...args) => send({ type: "log", level: "info", msg: args.join(" ") });
console.error = (...args) => send({ type: "log", level: "error", msg: args.join(" ") });

/** Replies to `notebooks.run` and to `files.write` arrive the same way, on the same channel. */
const pending = new Map();
const fileWrites = new Map();
let nextCallId = 0;
let nextFileId = 0;

let canCall = false;
let canWriteFile = false;
let started = false;

process.on("message", (msg) => {
  if (!started) {
    started = true;
    void run(msg);
    return;
  }
  const waiting =
    msg?.type === "call:result"
      ? pending.get(msg.id)
      : msg?.type === "file:result"
        ? fileWrites.get(msg.id)
        : undefined;
  if (!waiting) return;

  if (msg.type === "call:result") {
    // Files the callee handed back, copied in by the engine before this reply was sent.
    for (const [key, copy] of Object.entries(msg.staged ?? {})) staged.set(key, copy);
    pending.delete(msg.id);
  }
  else fileWrites.delete(msg.id);

  if (msg.ok) waiting.resolve(msg.value);
  else waiting.reject(new Error(msg.error));
});

/**
 * Ends this process once the terminal message is on its way. The engine does not have to
 * kill a cell that finished; it only does if this has not exited a moment later.
 */
function finish(msg) {
  send(msg, () => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

function fail(err) {
  const error = err instanceof Error ? err : new Error(String(err));
  finish({ type: "error", error: error.message, stack: error.stack });
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

const notebooks = {
  run(notebook, input) {
    if (!canCall) {
      return Promise.reject(new Error("Calling another notebook is not available here"));
    }
    if (typeof notebook !== "string" || notebook.trim() === "") {
      return Promise.reject(new Error("notebooks.run needs a notebook id or name"));
    }
    return new Promise((resolve, reject) => {
      const id = ++nextCallId;
      pending.set(id, { resolve, reject });
      send({ type: "call", id, notebook, input });
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
  write(name, data, encoding) {
    if (!canWriteFile) {
      return Promise.reject(new Error("Writing a file is not available here"));
    }

    let payload;
    let sent;

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
      send({ type: "file:write", id, name, data: payload, encoding: sent });
    });
  },
};

async function run(init) {
  try {
    const { code, inputs, inputsSchema, packages } = init;
    canCall = Boolean(init.canCall);
    canWriteFile = Boolean(init.canWriteFile);
    for (const [key, copy] of Object.entries(init.staged ?? {})) staged.set(key, copy);

    /**
     * `require`, narrowed to what the notebook declared.
     *
     * It used to resolve out of the engine's own `node_modules`, which meant a cell could
     * `require('pg')` and open a client to the database this application runs on. Nothing
     * about writing a notebook should reach that far, and nothing announced that it could.
     *
     * Node's own built-ins stay: a cell that wants `crypto` or `fs` is doing ordinary work.
     * What it can do with `fs` is bounded by the permission model this process runs under:
     * it reads its declared packages and its own folder (the files staged for it) and writes nothing.
     */
    const allowed = new Set(Array.isArray(packages) ? packages : []);

    const scopedRequire = (specifier) => {
      const name = String(specifier ?? "");
      const bare = name.replace(/^node:/, "").split("/")[0];

      if (DENIED_BUILTINS.has(bare)) {
        throw new Error(`require("${name}") is not available in a notebook cell.`);
      }

      // A path is not a package, and there is nothing on this disk a cell should be reading
      // by path — the notebook is the unit, not the filesystem around it.
      if (name.startsWith(".") || name.startsWith("/")) {
        throw new Error(`require("${name}") is not available: a cell cannot load files by path.`);
      }

      if (allowed.has(bare) || builtinModules.includes(bare)) return nodeRequire(name);

      throw new Error(
        `require("${name}") is not available. Declare it in the notebook's \`packages:\` list, ` +
          "or use one of node's built-in modules."
      );
    };

    // Wrap inputs based on schema type
    const wrappedInputs = { ...inputs };
    if (Array.isArray(inputsSchema)) {
      for (const field of inputsSchema) {
        const key = field.name;
        const value = inputs[key];
        if (value !== undefined && value !== null) {
          if (field.type === "table") wrappedInputs[key] = new Table(value);
          else if (field.type === "file") wrappedInputs[key] = new FileObject(value);
          else if (field.type === "image") wrappedInputs[key] = new ImageObject(value);
        }
      }
    }

    // Wrap the cell's code in an async function. Running the code a notebook author wrote IS
    // this process's job, so dynamic code here is intended, not an injection. The boundary is
    // the process, not the language: this runs in a `node --permission` process of its own,
    // one per cell, as the notebook owner's own Linux uid (K-02, FX-20). It cannot write
    // files, start processes, threads or addons, and sees only the secrets the notebook
    // declares. Reviewed 2026-11-23; see ARCHITECTURE.md "Sandboxing, honestly".
    const fn = new Function( // NOSONAR: executing the cell's code is the purpose of this sandboxed process
      "inputs",
      "require",
      "Table",
      "FileObject",
      "ImageObject",
      "notebooks",
      "files",
      `"use strict"; return (async () => { ${code} })()`
    );
    const output = await fn( // NOSONAR: calls the cell compiled above, inside the same sandboxed process
      wrappedInputs,
      scopedRequire,
      Table,
      FileObject,
      ImageObject,
      notebooks,
      files
    );
    const cleanOutput = output !== undefined ? JSON.parse(JSON.stringify(output)) : undefined;
    finish({ type: "done", output: cleanOutput });
  } catch (err) {
    fail(err);
  }
}

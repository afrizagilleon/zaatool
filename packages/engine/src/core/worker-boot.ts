import { workerData, parentPort } from "worker_threads";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { code, inputs, secrets, inputsSchema } = workerData;

if (secrets) {
  Object.assign(process.env, secrets);
}

// catch console.log from user's code → send as event log
const originalLog = console.log;
console.log = (...args) => {
  parentPort?.postMessage({ type: "log", level: "info", msg: args.join(" ") });
};
console.error = (...args) => {
  parentPort?.postMessage({ type: "log", level: "error", msg: args.join(" ") });
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
      `"use strict"; return (async () => { ${code} })()`,
    );
    const output = await fn(wrappedInputs, require, Table, FileObject, ImageObject);
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

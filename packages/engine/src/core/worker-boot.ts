import { workerData, parentPort } from "worker_threads";

const { code, inputs } = workerData;

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
    // wrap user's code in an async function
    const fn = new Function(
      "inputs",
      `"use strict"; return (async () => { ${code} })()`,
    );
    const output = await fn(inputs);
    parentPort?.postMessage({ type: "done", output });
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

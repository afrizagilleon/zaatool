/**
 * The channel a running cell uses to call another notebook.
 *
 * Cells execute out of process — a worker thread for JavaScript, a child process for
 * Python — precisely so they cannot reach the engine. Reuse needs exactly one hole in
 * that wall, so it is this: a single request shape, answered by the engine, carrying
 * only JSON. The runners bridge it; nothing in `core/` knows how a notebook is loaded.
 */

export interface NotebookCallRequest {
  /** Notebook id, or its exact name. */
  notebook: string;
  input?: Record<string, unknown>;
}

/** Where a callee's log lines surface: the calling cell's own output. */
export type NotebookLogSink = (level: string, message: string) => void;

/**
 * Resolves with the callee's declared outputs, or rejects with its failure.
 *
 * The log sink is supplied by the runner rather than the caller, because only the
 * runner knows which cell is waiting on this call.
 */
export type NotebookCaller = (
  request: NotebookCallRequest,
  log?: NotebookLogSink
) => Promise<Record<string, unknown>>;

/**
 * Marks a protocol line on the Python child's stdout.
 *
 * Python has one stdout and user code prints to it freely, so protocol frames need to
 * be unmistakable. Anything without this prefix is treated as a log line, which also
 * fixes plain `print()` breaking a cell's result.
 */
export const PY_RPC_PREFIX = "@@zaa-rpc@@";

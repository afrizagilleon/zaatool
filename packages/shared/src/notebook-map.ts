import type { NotebookRuntime } from "./notebook.js";

/**
 * The shape of the system, derived from the notebooks themselves.
 *
 * Nobody draws this. It is computed from the stored documents every time it is asked
 * for, which is the whole difference between it and the canvas it replaces: a drawn
 * graph is a thing you must keep true, and a derived one cannot be false. If an arrow
 * is here, there is a `notebooks.run` in that cell's code.
 *
 * Read by the browser to render the map, and by an agent over MCP to answer "what
 * would I break if I changed this" in one call.
 */

export interface NotebookMapNotebook {
  id: string;
  name: string;
  runtime: NotebookRuntime;
  /** Rendered as `name: type` with `!` for required, so the map shows the contract. */
  inputs: string[];
  outputs: string[];
  secrets: string[];
  cellCount: number;
  /** Parallel groups, which is what makes a notebook worth drawing rather than listing. */
  parallelCount: number;
  updatedAt: string;
}

export interface NotebookMapTrigger {
  id: string;
  notebookId: string;
  kind: "cron" | "webhook";
  /** The cron expression, or the webhook path. */
  label: string;
  enabled: boolean;
}

/**
 * One `notebooks.run(...)` found in a cell.
 *
 * `resolved` is false when the call names something that is not there, and `dynamic`
 * is true when the name is computed rather than written down. Both are shown rather
 * than dropped: a map that quietly omits what it could not work out is worse than one
 * that says so.
 */
export interface NotebookMapCall {
  fromNotebookId: string;
  fromCellId: string;
  reference: string;
  toNotebookId: string | null;
  resolved: boolean;
  dynamic: boolean;
  ambiguous: boolean;
}

export interface NotebookMap {
  notebooks: NotebookMapNotebook[];
  triggers: NotebookMapTrigger[];
  calls: NotebookMapCall[];
}

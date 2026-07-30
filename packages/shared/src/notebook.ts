/**
 * Notebook document contract.
 *
 * A notebook is a linear sequence of steps. Parallelism is expressed by a
 * structured `parallel` step containing lanes, never by free-form edges — fork
 * and join are implied by the structure, so a notebook is always a valid DAG and
 * can never contain a cycle.
 *
 * Deliberately absent: any field holding execution results. A notebook document
 * is a definition. Outputs belong to a run, so a saved notebook can never show
 * results from a previous session.
 */

/** One notebook, one language. Values crossing a cell boundary must be JSON. */
export type NotebookRuntime = "node" | "python";

/**
 * One unit of work: the note explaining it, the code implementing it, and (at
 * run time, never in the document) that code's output.
 *
 * Both parts are optional, which covers what used to need two cell kinds: a
 * note alone is a heading or explanation, code alone is a plain step, and
 * together they keep intent and implementation from drifting apart. The note is
 * also the spec an AI assistant reads when writing or revising this cell's code.
 */
/** Which parts of a cell are folded away. */
export interface CellFolding {
  note?: boolean;
  code?: boolean;
  output?: boolean;
}

export interface NotebookCell {
  id: string;
  kind: "cell";
  note?: string;
  /** Whatever the code returns is merged into the notebook scope by name. */
  code?: string;
  timeoutMs?: number;
  /**
   * Authoring state, persisted deliberately: how a long notebook is folded is
   * part of how its author arranged it, the same way a canvas stored viewport.
   * This is not a result — the rule that outputs never enter the document holds.
   */
  collapsed?: CellFolding;
}

export interface NotebookLane {
  id: string;
  label?: string;
  steps: NotebookStep[];
}

/**
 * Lanes execute concurrently. Each lane reads the shared scope but writes only
 * to its own; those writes are merged back when every lane has finished.
 */
export interface ParallelStep {
  id: string;
  kind: "parallel";
  lanes: NotebookLane[];
}

export type NotebookStep = NotebookCell | ParallelStep;

export interface NotebookJson {
  version: string;
  id: string;
  name: string;
  runtime: NotebookRuntime;
  /** Secret keys this notebook may read; undeclared means none. */
  secrets?: string[];
  steps: NotebookStep[];
}

export interface NotebookSummary {
  id: string;
  name: string;
  runtime: NotebookRuntime;
  created_at: string;
  updated_at: string;
}

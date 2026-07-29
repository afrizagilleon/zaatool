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

export interface MarkdownCell {
  id: string;
  kind: "markdown";
  /** Prose. Also the intent an AI assistant reads when generating the next cell. */
  source: string;
}

export interface CodeCell {
  id: string;
  kind: "code";
  /** Cell body. Whatever it returns is merged into the notebook scope by name. */
  source: string;
  timeoutMs?: number;
}

export type NotebookCell = MarkdownCell | CodeCell;

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

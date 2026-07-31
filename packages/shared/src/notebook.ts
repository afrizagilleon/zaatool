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

/**
 * Triggers belong to the notebook, not to a cell.
 *
 * A trigger is the reason a run starts, not a step of the computation. Modelling it
 * as a cell made the first cell a special case everywhere — the canvas did that with
 * `trigger:cron` nodes, which forced the scheduler to scan every graph's contents once
 * a minute. As notebook metadata they are indexed and simply queried.
 */
export interface CronTrigger {
  id: string;
  kind: "cron";
  /** Five-field expression: minute hour day-of-month month day-of-week. */
  cron: string;
  enabled?: boolean;
}

export interface WebhookTrigger {
  id: string;
  kind: "webhook";
  /** Path segment of the public URL. Unguessable by default. */
  slug: string;
  /**
   * Name of a row in the secrets store whose value must be sent as
   * `X-Webhook-Secret`. Referenced rather than inlined so no credential is
   * stored in the notebook document.
   */
  secretKey?: string;
  enabled?: boolean;
}

export type NotebookTrigger = CronTrigger | WebhookTrigger;

/**
 * The reuse boundary.
 *
 * Inside a notebook, dependencies stay implicit through shared scope — that is what
 * makes it readable top to bottom. The moment another notebook calls this one, that
 * scope becomes an interface, and an interface nobody wrote down is one nobody can
 * change safely. So a contract is explicit, and only here.
 *
 * Both halves are optional: a notebook with no declared inputs takes no arguments,
 * and one with no declared outputs returns nothing to a caller. Neither prevents it
 * from being run on its own.
 */
export type NotebookParamType = "string" | "number" | "boolean" | "json";

export interface NotebookParam {
  name: string;
  type: NotebookParamType;
  /** Without a default, a missing required value is an error before anything runs. */
  required?: boolean;
  description?: string;
  default?: unknown;
}

export interface NotebookJson {
  version: string;
  id: string;
  name: string;
  runtime: NotebookRuntime;
  /** Secret keys this notebook may read; undeclared means none. */
  secrets?: string[];
  triggers?: NotebookTrigger[];
  /** Values a caller supplies, seeded into scope before the first cell. */
  inputs?: NotebookParam[];
  /** Names lifted from the final scope and handed back to the caller. */
  outputs?: string[];
  steps: NotebookStep[];
}

export interface NotebookSummary {
  id: string;
  name: string;
  runtime: NotebookRuntime;
  created_at: string;
  updated_at: string;
}

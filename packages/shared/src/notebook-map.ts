import type { NotebookRuntime, NotebookTrigger } from "./notebook.js";

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
  /** Libraries its cells import. Changing this is a production change, so the map says it. */
  packages: string[];
  cellCount: number;
  /** Parallel groups, which is what makes a notebook worth drawing rather than listing. */
  parallelCount: number;
  /**
   * Whether production is running a version of this.
   *
   * On the map because it changes what an arrow *means*: a call into an undeployed
   * notebook still runs — a call reads the draft — but a trigger on one does nothing, and
   * a box that cannot say which it is leaves you to open it and find out.
   */
  deployed: boolean;
  updatedAt: string;
}

export interface NotebookMapTrigger {
  id: string;
  notebookId: string;
  kind: "cron" | "webhook";
  /** The cron expression, or the webhook path. */
  label: string;
  enabled: boolean;
  /**
   * True when this trigger exists only in the draft — or differs from the deployed one —
   * so nothing is listening to it yet. Every other trigger on the map is read from the
   * deployed version, which is what production actually answers to.
   */
  draft?: boolean;
}

/** Whether two triggers would make production listen to the same thing, the same way. */
function sameTrigger(a: NotebookTrigger, b: NotebookTrigger): boolean {
  if (a.id !== b.id || a.kind !== b.kind || (a.enabled !== false) !== (b.enabled !== false)) {
    return false;
  }
  if (a.kind === "cron" && b.kind === "cron") return a.cron.trim() === b.cron.trim();
  if (a.kind === "webhook" && b.kind === "webhook") {
    return a.slug.trim() === b.slug.trim() && (a.secretKey?.trim() ?? "") === (b.secretKey?.trim() ?? "");
  }
  return false;
}

/**
 * Whether production already has exactly this trigger.
 *
 * Production listens to the *deployed* version's triggers and to nothing in the draft, so
 * a draft trigger that is absent from — or different in — the deployed version is not
 * active yet. `deployed` is null when nothing is deployed.
 */
export function isTriggerDeployed(
  trigger: NotebookTrigger,
  deployed: readonly NotebookTrigger[] | null | undefined
): boolean {
  return (deployed ?? []).some((live) => sameTrigger(live, trigger));
}

/**
 * Whether a draft trigger is waiting for a deploy before it does anything.
 *
 * Only an enabled trigger can be waiting: a switched-off one has nothing to activate. One
 * definition, because the editor's trigger panel, the deploy review and the map all have
 * to agree about which triggers are in that state.
 */
export function isTriggerPending(
  trigger: NotebookTrigger,
  deployed: readonly NotebookTrigger[] | null | undefined
): boolean {
  return trigger.enabled !== false && !isTriggerDeployed(trigger, deployed);
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

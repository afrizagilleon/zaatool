import type { NotebookOutput, NotebookRunDetail, NotebookRunSummary, RunEvent } from "@zaa-tool/shared";
import { outputNames } from "./notebook-outputs.js";

/**
 * What a reader is allowed to learn about a run.
 *
 * A run record holds everything a notebook did: the code of every cell, what each one
 * printed, every value in between, and the raw text of whatever error stopped it. That is
 * the right thing for the people who work on the notebook, and exactly wrong for everyone
 * else who can reach a run — somebody using the app, a visitor with a share link, a webhook
 * caller, an agent of another account calling the app as a tool, a notebook of another owner
 * that called this one. Those readers asked a question and are owed the *answer*.
 *
 * So there are two views, and every door that hands a run to a client picks one:
 *
 *  - {@link fullView}: owner and editors. The whole record (already redacted of secrets when
 *    it was written).
 *  - {@link publicView}: everybody else. The run's id, status and timings, the notebook's
 *    **declared outputs** (the `outputs` contract) and, when it failed, a generic error that
 *    names the run so the owner can look it up. No cell source, no logs, no values of cells
 *    that were not declared outputs, no error text: an error message is whatever the cell's
 *    author wrote into it, and often a request URL or a response body.
 *
 * Which view applies is decided by `notebookAccessService.runScope` (`all` is the full view),
 * never by the caller of this module; this file only does what it is told.
 */

/** What a public reader is told when a run failed. The run id is the reference the owner can search for. */
export const genericRunError = (runId: string): string => `Run failed (run ${runId})`;

/** The part of a notebook's document the projection needs: which outputs it promised. */
export interface RunContract {
  outputs?: Array<string | NotebookOutput>;
}

/**
 * The owner's and editors' view: the record as stored, which was redacted when it was
 * written. Only the engine's own bookkeeping (which share link started it) is left out.
 */
export function fullView<T>(run: T): T {
  if (typeof run !== "object" || run === null || !("share_id" in run)) return run;
  const { share_id: _shareId, ...rest } = run as Record<string, unknown>;
  return rest as T;
}

function onlyDeclared(
  outputs: Record<string, unknown> | null | undefined,
  contract: RunContract | null | undefined
): Record<string, unknown> {
  if (!outputs || typeof outputs !== "object") return {};
  // No contract to check against (the notebook is gone, or was never deployed) leaves
  // nothing declared: better an empty answer than a guess at what was meant to be shown.
  if (!contract) return {};
  const declared = new Set(outputNames(contract.outputs));
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(outputs)) {
    if (declared.has(name)) kept[name] = value;
  }
  return kept;
}

type RunLike = Pick<
  NotebookRunSummary,
  "id" | "notebook_id" | "status" | "trigger_source" | "started_at" | "finished_at"
> & { outputs?: Record<string, unknown> | null };

function summaryFields(run: RunLike) {
  return {
    id: run.id,
    notebook_id: run.notebook_id,
    status: run.status,
    trigger_source: run.trigger_source,
    // Which cell was run, which run asked for this one and which account started it are
    // facts about how the notebook is built and who else uses it.
    cell_id: null,
    parent_run_id: null,
    started_by: null,
    error: run.status === "failed" ? genericRunError(run.id) : null,
    started_at: run.started_at,
    finished_at: run.finished_at,
  };
}

/** One run for somebody who may only be told how it came out. Same shape as the full record, emptied. */
export function publicView(
  run: RunLike,
  contract: RunContract | null | undefined
): NotebookRunDetail {
  return {
    ...summaryFields(run),
    cell_results: {},
    outputs: run.status === "success" ? onlyDeclared(run.outputs, contract) : null,
  };
}

/** A line of a run listing for the same reader. */
export function publicSummary(run: NotebookRunSummary): NotebookRunSummary {
  return summaryFields(run);
}

/**
 * A run event for a reader who may only follow how the run came out.
 *
 * Almost everything is dropped. `cell:log` and `cell:done` carry what the cells printed and
 * produced, `cell:error` carries error text, and `cell:start` names a cell and so says how
 * the notebook is built. What is left is the end of the run: success with the declared
 * outputs the runner attached, or failure with the generic error.
 */
export function publicEvent(event: RunEvent, contract?: RunContract | null): RunEvent | null {
  if (event.type === "run:done") {
    const outputs =
      event.outputs && typeof event.outputs === "object"
        ? (event.outputs as Record<string, unknown>)
        : {};
    return {
      type: "run:done",
      runId: event.runId,
      notebookId: event.notebookId,
      status: "success",
      ms: Number(event.ms ?? 0),
      // The runner only ever lifts declared names into this; the contract check is for the
      // day something else starts putting more on the event.
      outputs: contract === undefined ? outputs : onlyDeclared(outputs, contract),
    };
  }
  if (event.type === "run:error") {
    return {
      type: "run:error",
      runId: event.runId,
      notebookId: event.notebookId,
      error: genericRunError(event.runId),
      ms: Number(event.ms ?? 0),
    };
  }
  return null;
}

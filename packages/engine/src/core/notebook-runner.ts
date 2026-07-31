import { EventEmitter } from "node:events";
import { NotebookScope } from "./notebook-scope.js";
import { runJsNode } from "./js-runner.js";
import { runPythonNode } from "./python-runner.js";
import { selectOutputs } from "./notebook-contract.js";
import type { NotebookCaller } from "./notebook-call.js";
import type { NotebookPlan, PlanCell, PlanLane, PlanParallel, PlanStep } from "./notebook-compiler.js";

export interface RunNotebookOptions {
  ee?: EventEmitter;
  /** Resolved secrets, already narrowed to what the notebook declared. */
  secrets?: Record<string, string>;
  /** Values seeded into scope before the first cell — a trigger payload, for instance. */
  input?: Record<string, unknown>;
  /**
   * How a cell reaches another notebook. Absent means cells cannot call out, which
   * is what a caller wants when there is nothing sensible to call into.
   */
  call?: NotebookCaller;
}

export interface NotebookRunResult {
  status: "success" | "failed";
  errors: string[];
  ms: number;
  /** The plan's declared outputs, lifted from the final scope. */
  outputs: Record<string, unknown>;
}

/** Thrown internally to unwind a lane or the notebook; never escapes runNotebook. */
class CellFailure extends Error {
  constructor(readonly cellId: string, message: string) {
    super(message);
    this.name = "CellFailure";
  }
}

/** Both runners honour the same contract, so a notebook picks one and never branches again. */
type CellRunner = typeof runJsNode;

function runnerFor(plan: NotebookPlan): CellRunner {
  return plan.runtime === "python" ? (runPythonNode as CellRunner) : runJsNode;
}

/**
 * Executes a compiled notebook.
 *
 * Always reports its outcome through a terminal event and a returned result —
 * it does not throw on cell failure, so every caller sees success and failure
 * the same way regardless of where in the notebook things went wrong.
 */
export async function runNotebook(
  plan: NotebookPlan,
  options: RunNotebookOptions = {}
): Promise<NotebookRunResult> {
  const { ee, secrets = {}, input, call } = options;
  const startedAt = Date.now();
  const runCell = runnerFor(plan);
  const rootScope = new NotebookScope();

  if (input) rootScope.merge(input);

  async function executeCell(step: PlanCell, scope: NotebookScope): Promise<void> {
    ee?.emit("cell:start", { type: "cell:start", cellId: step.cellId });
    const cellStartedAt = Date.now();

    // A called notebook's logs belong to the cell that is waiting on it, which only
    // this loop knows — so the sink is attached here rather than by whoever built
    // the caller.
    const callFromCell: NotebookCaller | undefined = call
      ? (request) =>
          call(request, (level, msg) => {
            ee?.emit("cell:log", { type: "cell:log", cellId: step.cellId, level, payload: msg });
          })
      : undefined;

    const result = await runCell(
      step.source,
      scope.snapshot(),
      step.timeoutMs,
      (level, msg) => {
        ee?.emit("cell:log", { type: "cell:log", cellId: step.cellId, level, payload: msg });
      },
      secrets,
      [],
      callFromCell
    );

    if (result.error) {
      ee?.emit("cell:error", {
        type: "cell:error",
        cellId: step.cellId,
        error: result.error,
        ms: Date.now() - cellStartedAt,
      });
      throw new CellFailure(step.cellId, result.error);
    }

    const written = scope.merge(result.output);

    ee?.emit("cell:done", {
      type: "cell:done",
      cellId: step.cellId,
      output: result.output ?? {},
      written,
      ms: Date.now() - cellStartedAt,
    });
  }

  /**
   * Lanes run concurrently in child scopes, then their writes are merged back.
   * Two lanes writing the same name is a conflict, not a last-one-wins race —
   * the whole point of the structure is that the result cannot depend on timing.
   */
  async function executeParallel(step: PlanParallel, scope: NotebookScope): Promise<void> {
    const laneScopes = step.lanes.map(() => new NotebookScope(scope));

    const settled = await Promise.allSettled(
      step.lanes.map((lane, index) => executeSteps(lane.steps, laneScopes[index]))
    );

    const failures = settled
      .map((outcome, index) => ({ outcome, lane: step.lanes[index] }))
      .filter((entry) => entry.outcome.status === "rejected");

    // Lanes are named for the reader's benefit, so failures are reported by label
    // rather than by the ids only the machine cares about.
    const nameOf = (lane: PlanLane) => lane.label || lane.laneId;

    if (failures.length > 0) {
      const messages = failures.map((entry) => {
        const reason = (entry.outcome as PromiseRejectedResult).reason;
        return reason instanceof CellFailure
          ? `lane "${nameOf(entry.lane)}": ${reason.message}`
          : `lane "${nameOf(entry.lane)}": ${(reason as Error).message}`;
      });
      throw new CellFailure(step.groupId, messages.join("; "));
    }

    const writerOf = new Map<string, PlanLane>();
    for (const [index, lane] of step.lanes.entries()) {
      for (const [name, value] of laneScopes[index].localEntries()) {
        const previousWriter = writerOf.get(name);
        if (previousWriter !== undefined) {
          throw new CellFailure(
            step.groupId,
            `lanes "${nameOf(previousWriter)}" and "${nameOf(lane)}" both wrote "${name}" — ` +
              `parallel lanes must not write the same name`
          );
        }
        writerOf.set(name, lane);
        scope.set(name, value);
      }
    }
  }

  async function executeSteps(steps: PlanStep[], scope: NotebookScope): Promise<void> {
    for (const step of steps) {
      if (step.kind === "code") {
        await executeCell(step, scope);
      } else {
        await executeParallel(step, scope);
      }
    }
  }

  try {
    await executeSteps(plan.steps, rootScope);
    const ms = Date.now() - startedAt;
    const outputs = selectOutputs(plan.outputs, rootScope.snapshot());
    ee?.emit("run:done", { type: "run:done", status: "success", ms });
    return { status: "success", errors: [], ms, outputs };
  } catch (err: unknown) {
    const ms = Date.now() - startedAt;
    const failure = err instanceof CellFailure ? err : null;
    const message = failure ? failure.message : (err as Error).message;

    // The id travels as its own field rather than being spliced into the message,
    // so a client can link to the failing cell instead of printing a raw uuid.
    ee?.emit("run:error", {
      type: "run:error",
      error: message,
      ...(failure ? { cellId: failure.cellId } : {}),
      ms,
    });
    return { status: "failed", errors: [message], ms, outputs: {} };
  }
}

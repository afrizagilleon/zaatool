import type {
  NotebookJson,
  NotebookLane,
  NotebookRuntime,
  NotebookStep,
} from "@zaa-tool/shared";

const DEFAULT_CELL_TIMEOUT_MS = 30_000;
const VALID_RUNTIMES: NotebookRuntime[] = ["node", "python"];

export interface PlanCell {
  kind: "code";
  cellId: string;
  source: string;
  timeoutMs: number;
}

export interface PlanLane {
  laneId: string;
  label?: string;
  steps: PlanStep[];
}

export interface PlanParallel {
  kind: "parallel";
  groupId: string;
  lanes: PlanLane[];
}

export type PlanStep = PlanCell | PlanParallel;

export interface NotebookPlan {
  notebookId: string;
  runtime: NotebookRuntime;
  secrets: string[];
  steps: PlanStep[];
}

export class NotebookCompileError extends Error {
  constructor(readonly issues: string[]) {
    super(`Notebook is not runnable:\n- ${issues.join("\n- ")}`);
    this.name = "NotebookCompileError";
  }
}

/**
 * Turns a notebook document into an execution plan.
 *
 * Validation lives here rather than in the runner so a malformed notebook is
 * rejected before anything executes, and so the editor can surface the same
 * issues without starting a run. Markdown and blank code cells are dropped —
 * they carry intent, not computation.
 */
export function compileNotebook(notebook: NotebookJson): NotebookPlan {
  const issues: string[] = [];
  const seenIds = new Set<string>();

  if (!VALID_RUNTIMES.includes(notebook.runtime)) {
    issues.push(`Unknown runtime "${notebook.runtime}" (expected node or python)`);
  }

  const claimId = (id: string | undefined, what: string): void => {
    if (!id) {
      issues.push(`${what} is missing an id`);
      return;
    }
    if (seenIds.has(id)) {
      issues.push(`Duplicate id "${id}" — every cell, lane and group needs its own`);
      return;
    }
    seenIds.add(id);
  };

  const compileSteps = (steps: NotebookStep[] | undefined, where: string): PlanStep[] => {
    if (!Array.isArray(steps)) {
      issues.push(`${where} has no steps array`);
      return [];
    }

    const plan: PlanStep[] = [];

    for (const step of steps) {
      if (step.kind === "parallel") {
        claimId(step.id, `Parallel group in ${where}`);
        plan.push(compileParallel(step.id, step.lanes, where));
        continue;
      }

      if (step.kind === "markdown") {
        claimId(step.id, `Markdown cell in ${where}`);
        continue;
      }

      if (step.kind === "code") {
        claimId(step.id, `Code cell in ${where}`);
        const source = typeof step.source === "string" ? step.source : "";
        if (source.trim().length === 0) continue;

        plan.push({
          kind: "code",
          cellId: step.id,
          source,
          timeoutMs:
            typeof step.timeoutMs === "number" && step.timeoutMs > 0
              ? step.timeoutMs
              : DEFAULT_CELL_TIMEOUT_MS,
        });
        continue;
      }

      issues.push(`Unknown step kind "${(step as { kind?: string }).kind}" in ${where}`);
    }

    return plan;
  };

  const compileParallel = (
    groupId: string,
    lanes: NotebookLane[] | undefined,
    where: string
  ): PlanParallel => {
    if (!Array.isArray(lanes) || lanes.length === 0) {
      issues.push(`Parallel group "${groupId}" in ${where} has no lanes`);
      return { kind: "parallel", groupId, lanes: [] };
    }

    const planLanes: PlanLane[] = lanes.map((lane) => {
      claimId(lane.id, `Lane in parallel group "${groupId}"`);
      if (!Array.isArray(lane.steps) || lane.steps.length === 0) {
        issues.push(`Lane "${lane.id}" in group "${groupId}" is empty`);
      }
      return {
        laneId: lane.id,
        label: lane.label,
        steps: compileSteps(lane.steps ?? [], `lane "${lane.id}"`),
      };
    });

    return { kind: "parallel", groupId, lanes: planLanes };
  };

  const steps = compileSteps(notebook.steps, "notebook");

  if (issues.length > 0) {
    throw new NotebookCompileError(issues);
  }

  return {
    notebookId: notebook.id,
    runtime: notebook.runtime,
    secrets: Array.isArray(notebook.secrets)
      ? [...new Set(notebook.secrets.filter((k): k is string => typeof k === "string" && k.length > 0))]
      : [],
    steps,
  };
}

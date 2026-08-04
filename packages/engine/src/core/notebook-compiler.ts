import type {
  NotebookJson,
  NotebookLane,
  NotebookParam,
  NotebookParamType,
  NotebookRuntime,
  NotebookStep,
} from "@zaa-tool/shared";
import { outputNames } from "./notebook-outputs.js";

const DEFAULT_CELL_TIMEOUT_MS = 30_000;
const VALID_RUNTIMES: NotebookRuntime[] = ["node", "python"];
const VALID_PARAM_TYPES: NotebookParamType[] = ["string", "number", "boolean", "json", "file"];

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
  /** Libraries the cells may import, as declared. Empty means the standard library. */
  packages: string[];
  /** The reuse contract, validated here so a bad one never reaches a run. */
  inputs: NotebookParam[];
  outputs: string[];
  steps: PlanStep[];
}

/**
 * Narrows a plan to a single cell, for "run just this one" from the editor.
 *
 * The scope that cell depends on is supplied by the caller as run input, which
 * works because values crossing a cell boundary are JSON by design — the
 * notebook's state is serialisable, so it can be rehydrated per request instead
 * of requiring a live kernel.
 */
export function selectPlanCell(plan: NotebookPlan, cellId: string): NotebookPlan | null {
  const find = (steps: PlanStep[]): PlanCell | null => {
    for (const step of steps) {
      if (step.kind === "code") {
        if (step.cellId === cellId) return step;
        continue;
      }
      for (const lane of step.lanes) {
        const found = find(lane.steps);
        if (found) return found;
      }
    }
    return null;
  };

  const cell = find(plan.steps);
  return cell ? { ...plan, steps: [cell] } : null;
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

      if (step.kind === "cell") {
        claimId(step.id, `Cell in ${where}`);
        // A cell with only a note carries intent, not computation.
        const source = typeof step.code === "string" ? step.code : "";
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

  /**
   * The contract is validated with the document, not at call time, so a notebook
   * whose interface is malformed is caught by its own author rather than by whoever
   * calls it months later.
   */
  const compileInputs = (): NotebookParam[] => {
    if (!Array.isArray(notebook.inputs)) return [];

    const claimed = new Set<string>();
    const params: NotebookParam[] = [];

    for (const param of notebook.inputs) {
      const name = typeof param?.name === "string" ? param.name.trim() : "";
      if (!name) {
        issues.push("An input is missing a name");
        continue;
      }
      if (claimed.has(name)) {
        issues.push(`Duplicate input "${name}"`);
        continue;
      }
      if (!VALID_PARAM_TYPES.includes(param.type)) {
        issues.push(`Input "${name}" has unknown type "${param.type}"`);
        continue;
      }
      claimed.add(name);
      params.push({ ...param, name });
    }

    return params;
  };

  const compileOutputs = (): string[] => {
    if (!Array.isArray(notebook.outputs)) return [];

    // How an output is *shown* is no concern of the runner, so the plan carries names
    // only. A nameless entry is still worth reporting: a caller destructuring the result
    // would silently get one property fewer than the contract promised. Duplicates are
    // not an error — saying a name twice asks for the same thing twice.
    for (const output of notebook.outputs) {
      const name = typeof output === "string" ? output.trim() : (output?.name ?? "").trim();
      if (!name) issues.push("An output is missing a name");
    }
    return outputNames(notebook.outputs);
  };

  const inputs = compileInputs();
  const outputs = compileOutputs();
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
    packages: Array.isArray(notebook.packages)
      ? [...new Set(notebook.packages.filter((p): p is string => typeof p === "string" && p.trim() !== ""))]
      : [],
    inputs,
    outputs,
    steps,
  };
}

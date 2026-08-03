import { v4 as uuidv4 } from 'uuid';
import type { NotebookCell, NotebookLane, NotebookStep, ParallelStep } from '@zaa-tool/shared';

/**
 * Pure edits over the notebook's step tree.
 *
 * Cells live at the top level or inside a parallel lane, so every mutation has to
 * recurse. Keeping that here — rather than in the store — means the tricky part is
 * testable in isolation, which is where nesting bugs would otherwise hide.
 *
 * All functions return new arrays and never mutate their input.
 */

export function newCell(): NotebookCell {
  return { id: uuidv4(), kind: 'cell', code: '' };
}

export function newLane(label: string): NotebookLane {
  return { id: uuidv4(), label, steps: [newCell()] };
}

export function newParallelGroup(laneCount = 2): ParallelStep {
  return {
    id: uuidv4(),
    kind: 'parallel',
    lanes: Array.from({ length: laneCount }, (_, index) => newLane(`Lane ${index + 1}`)),
  };
}

/** Rewrites the one cell with this id, wherever it sits. */
export function mapCell(
  steps: NotebookStep[],
  cellId: string,
  update: (cell: NotebookCell) => NotebookCell
): NotebookStep[] {
  return steps.map((step) => {
    if (step.kind === 'cell') {
      return step.id === cellId ? update(step) : step;
    }
    return {
      ...step,
      lanes: step.lanes.map((lane) => ({ ...lane, steps: mapCell(lane.steps, cellId, update) })),
    };
  });
}

/** Rewrites every cell in the tree — used by the fold-everything toggles. */
export function mapAllCells(
  steps: NotebookStep[],
  update: (cell: NotebookCell) => NotebookCell
): NotebookStep[] {
  return steps.map((step) =>
    step.kind === 'cell'
      ? update(step)
      : {
          ...step,
          lanes: step.lanes.map((lane) => ({ ...lane, steps: mapAllCells(lane.steps, update) })),
        }
  );
}

/** Every cell in the tree, in execution order. */
export function allCells(steps: NotebookStep[]): NotebookCell[] {
  return steps.flatMap((step) =>
    step.kind === 'cell' ? [step] : step.lanes.flatMap((lane) => allCells(lane.steps))
  );
}

/** True when the step is last in the list it belongs to — its lane, not the notebook. */
export function isLastInList(steps: NotebookStep[], stepId: string): boolean {
  const at = steps.findIndex((step) => step.id === stepId);
  if (at >= 0) return at === steps.length - 1;

  return steps.some(
    (step) =>
      step.kind === 'parallel' &&
      step.lanes.some((lane) => isLastInList(lane.steps, stepId))
  );
}

/**
 * Cells that depend on this one: the rest of its own list, then everything after
 * the group that contains it, recursively outwards.
 *
 * Sibling lanes are excluded on purpose — lanes read the scope as it stood at the
 * fork, so one lane's result cannot affect another's.
 */
export function cellsAfter(steps: NotebookStep[], cellId: string): string[] {
  const search = (list: NotebookStep[]): { found: boolean; after: string[] } => {
    for (let index = 0; index < list.length; index += 1) {
      const step = list[index];
      const rest = () => allCells(list.slice(index + 1)).map((cell) => cell.id);

      if (step.kind === 'cell') {
        if (step.id === cellId) return { found: true, after: rest() };
        continue;
      }

      for (const lane of step.lanes) {
        const inLane = search(lane.steps);
        if (inLane.found) return { found: true, after: [...inLane.after, ...rest()] };
      }
    }
    return { found: false, after: [] };
  };

  return search(steps).after;
}

export function findCell(steps: NotebookStep[], cellId: string): NotebookCell | null {
  for (const step of steps) {
    if (step.kind === 'cell') {
      if (step.id === cellId) return step;
      continue;
    }
    for (const lane of step.lanes) {
      const found = findCell(lane.steps, cellId);
      if (found) return found;
    }
  }
  return null;
}

/** Inserts after the given step, in whichever list that step belongs to. */
export function insertAfter(
  steps: NotebookStep[],
  afterStepId: string,
  toInsert: NotebookStep
): NotebookStep[] {
  const at = steps.findIndex((step) => step.id === afterStepId);
  if (at >= 0) {
    const next = [...steps];
    next.splice(at + 1, 0, toInsert);
    return next;
  }

  return steps.map((step) =>
    step.kind === 'cell'
      ? step
      : {
          ...step,
          lanes: step.lanes.map((lane) => ({
            ...lane,
            steps: insertAfter(lane.steps, afterStepId, toInsert),
          })),
        }
  );
}

/**
 * Removes a step. A lane is never left empty and a group is never left without
 * lanes — the compiler rejects both, so the editor must not be able to create them.
 */
export function removeStep(steps: NotebookStep[], stepId: string): NotebookStep[] {
  const filtered = steps.filter((step) => step.id !== stepId);
  if (filtered.length !== steps.length) {
    return filtered.length > 0 ? filtered : [newCell()];
  }

  return steps.map((step) =>
    step.kind === 'cell'
      ? step
      : {
          ...step,
          lanes: step.lanes.map((lane) => ({ ...lane, steps: removeStep(lane.steps, stepId) })),
        }
  );
}

/** Moves a step within its own list; it never jumps in or out of a lane. */
export function moveStep(
  steps: NotebookStep[],
  stepId: string,
  direction: -1 | 1
): NotebookStep[] {
  const from = steps.findIndex((step) => step.id === stepId);
  if (from >= 0) {
    const to = from + direction;
    if (to < 0 || to >= steps.length) return steps;
    const next = [...steps];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  }

  return steps.map((step) =>
    step.kind === 'cell'
      ? step
      : {
          ...step,
          lanes: step.lanes.map((lane) => ({
            ...lane,
            steps: moveStep(lane.steps, stepId, direction),
          })),
        }
  );
}

function mapGroup(
  steps: NotebookStep[],
  groupId: string,
  update: (group: ParallelStep) => ParallelStep
): NotebookStep[] {
  return steps.map((step) => {
    if (step.kind === 'cell') return step;
    if (step.id === groupId) return update(step);
    return {
      ...step,
      lanes: step.lanes.map((lane) => ({ ...lane, steps: mapGroup(lane.steps, groupId, update) })),
    };
  });
}

export function addLane(steps: NotebookStep[], groupId: string): NotebookStep[] {
  return mapGroup(steps, groupId, (group) => ({
    ...group,
    lanes: [...group.lanes, newLane(`Lane ${group.lanes.length + 1}`)],
  }));
}

/** Dropping the last lane dissolves the group rather than leaving it invalid. */
export function removeLane(
  steps: NotebookStep[],
  groupId: string,
  laneId: string
): NotebookStep[] {
  const group = findGroup(steps, groupId);
  if (group && group.lanes.length <= 1) return removeStep(steps, groupId);

  return mapGroup(steps, groupId, (current) => ({
    ...current,
    lanes: current.lanes.filter((lane) => lane.id !== laneId),
  }));
}

export function setLaneLabel(
  steps: NotebookStep[],
  groupId: string,
  laneId: string,
  label: string
): NotebookStep[] {
  return mapGroup(steps, groupId, (group) => ({
    ...group,
    lanes: group.lanes.map((lane) => (lane.id === laneId ? { ...lane, label } : lane)),
  }));
}

/**
 * Appends a step to a lane — a cell, or another parallel group.
 *
 * The second case is what makes nesting reachable from the editor. It was always
 * reachable through the document (agents write it, the compiler accepts it, and it
 * really does run concurrently), which is the worst combination: a structure that
 * exists but that the tool appears to forbid.
 */
export function appendToLane(
  steps: NotebookStep[],
  groupId: string,
  laneId: string,
  toAppend: NotebookStep
): NotebookStep[] {
  return mapGroup(steps, groupId, (group) => ({
    ...group,
    lanes: group.lanes.map((lane) =>
      lane.id === laneId ? { ...lane, steps: [...lane.steps, toAppend] } : lane
    ),
  }));
}

/**
 * A readable name for a step: "Cell 3", "Lane 2 · Cell 1", "Parallel group".
 *
 * Errors reference the id, but nobody can match a uuid to what they see on screen —
 * this is what the id gets rendered as.
 */
export function stepLabel(steps: NotebookStep[], stepId: string): string | null {
  const search = (list: NotebookStep[], prefix: string): string | null => {
    let cellNumber = 0;

    for (const step of list) {
      if (step.kind === 'cell') {
        cellNumber += 1;
        if (step.id === stepId) return `${prefix}Cell ${cellNumber}`;
        continue;
      }

      if (step.id === stepId) return `${prefix}Parallel group`;

      for (const [index, lane] of step.lanes.entries()) {
        const laneName = lane.label || `Lane ${index + 1}`;
        const found = search(lane.steps, `${prefix}${laneName} · `);
        if (found) return found;
      }
    }
    return null;
  };

  return search(steps, '');
}

export function findGroup(steps: NotebookStep[], groupId: string): ParallelStep | null {
  for (const step of steps) {
    if (step.kind === 'cell') continue;
    if (step.id === groupId) return step;
    for (const lane of step.lanes) {
      const found = findGroup(lane.steps, groupId);
      if (found) return found;
    }
  }
  return null;
}

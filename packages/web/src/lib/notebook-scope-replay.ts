import type { NotebookStep } from '@zaa-tool/shared';
import type { CellRunState } from '../store/notebookTypes.js';

/**
 * Rebuilds the scope a cell would see, from the outputs of the cells before it.
 *
 * This is what lets a single cell run on its own without a live kernel: because
 * values crossing a cell boundary are JSON by design, the accumulated scope can
 * be sent along with the request and rehydrated server-side.
 *
 * It replays the *last run's* outputs, so it is only as trustworthy as the
 * freshness of the cells above — which is exactly what the stale indicator says.
 */
export function scopeBefore(
  steps: NotebookStep[],
  cellRuns: Record<string, CellRunState>,
  targetCellId: string
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  let reached = false;

  const merge = (cellId: string) => {
    const output = cellRuns[cellId]?.output;
    if (output && typeof output === 'object') Object.assign(scope, output);
  };

  const walk = (list: NotebookStep[]): void => {
    for (const step of list) {
      if (reached) return;

      if (step.kind === 'parallel') {
        // Lanes all read the scope as it stood at the fork, and their writes
        // land together at the join — so replay order within the group is
        // irrelevant, and a target inside a lane sees only pre-fork state.
        const targetInside = step.lanes.some((lane) => containsCell(lane.steps, targetCellId));
        if (targetInside) {
          reached = true;
          return;
        }
        for (const lane of step.lanes) walkLaneOutputs(lane.steps);
        continue;
      }

      if (step.id === targetCellId) {
        reached = true;
        return;
      }
      merge(step.id);
    }
  };

  const walkLaneOutputs = (list: NotebookStep[]): void => {
    for (const step of list) {
      if (step.kind === 'parallel') {
        for (const lane of step.lanes) walkLaneOutputs(lane.steps);
        continue;
      }
      merge(step.id);
    }
  };

  walk(steps);
  return scope;
}

function containsCell(steps: NotebookStep[], cellId: string): boolean {
  return steps.some((step) =>
    step.kind === 'parallel'
      ? step.lanes.some((lane) => containsCell(lane.steps, cellId))
      : step.id === cellId
  );
}

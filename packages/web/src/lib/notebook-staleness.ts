import type { NotebookStep } from '@zaa-tool/shared';
import type { CellRunState } from '../store/notebookTypes.js';

/**
 * Marks which cells can no longer be trusted to reflect a clean run.
 *
 * A cell is stale when its source changed since it last ran, or when anything
 * it depends on became stale. This is the guard against the notebook's classic
 * failure: an editor that looks green while a fresh production run would fail,
 * because the visible output came from code that no longer exists.
 *
 * With everything fresh, the editor is provably equivalent to a clean run.
 */
export function computeStaleCells(
  steps: NotebookStep[],
  cellRuns: Record<string, CellRunState>
): Record<string, boolean> {
  const stale: Record<string, boolean> = {};

  const walk = (list: NotebookStep[], inheritedStale: boolean): boolean => {
    let carried = inheritedStale;

    for (const step of list) {
      if (step.kind === 'markdown') continue;

      if (step.kind === 'parallel') {
        // Lanes are independent of one another, so a stale lane does not taint
        // its siblings — but it does taint everything after the group.
        let anyLaneStale = false;
        for (const lane of step.lanes) {
          if (walk(lane.steps, carried)) anyLaneStale = true;
        }
        carried = carried || anyLaneStale;
        continue;
      }

      const run = cellRuns[step.id];
      const neverRan = !run || run.ranSource === undefined;
      const edited = !neverRan && run.ranSource !== step.source;
      const isStale = carried || edited;

      stale[step.id] = isStale;
      if (isStale || neverRan) carried = true;
    }

    return carried;
  };

  walk(steps, false);
  return stale;
}

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

      // A note-only cell computes nothing, so it can never go stale.
      const code = step.code?.trim() ?? '';
      if (code.length === 0) continue;

      const run = cellRuns[step.id];
      // No recorded source means no way to check the result against the code that
      // is there now — a restored run from an older record looks like this. Such a
      // result is shown but never claimed to be current.
      const unverifiable = !run || run.ranSource === undefined;
      const edited = !unverifiable && run.ranSource !== step.code;
      const isStale = carried || edited || unverifiable;

      stale[step.id] = isStale;
      if (isStale) carried = true;
    }

    return carried;
  };

  walk(steps, false);
  return stale;
}

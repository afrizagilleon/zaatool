import type { NotebookCell, NotebookJson, NotebookStep } from "@zaa-tool/shared";

/**
 * Who last changed each cell.
 *
 * The question this answers is not "who is to blame" but "what should I look at". When
 * an agent writes forty cells you are not going to read forty cells; you are going to
 * read the ones that changed and who changed them.
 *
 * Stamped by the server, from the identity that authenticated the request, and always
 * recomputed — a writer cannot claim someone else wrote a cell by sending an `author`
 * field along with it.
 *
 * A cell is "changed" when its note or its code differs. Moving a cell, folding it, or
 * renaming the notebook around it leaves its authorship alone, because none of those
 * change what it does.
 */

function indexCells(steps: NotebookStep[] | undefined, into: Map<string, NotebookCell>): void {
  for (const step of steps ?? []) {
    if (step.kind === "parallel") {
      for (const lane of step.lanes ?? []) indexCells(lane.steps, into);
      continue;
    }
    into.set(step.id, step);
  }
}

function stampSteps(
  steps: NotebookStep[] | undefined,
  previous: Map<string, NotebookCell>,
  writer: string,
  at: string
): NotebookStep[] {
  return (steps ?? []).map((step) => {
    if (step.kind === "parallel") {
      return {
        ...step,
        lanes: (step.lanes ?? []).map((lane) => ({
          ...lane,
          steps: stampSteps(lane.steps, previous, writer, at),
        })),
      };
    }

    const before = previous.get(step.id);
    const unchanged =
      before !== undefined && before.note === step.note && before.code === step.code;

    // `unchanged` keeps whatever was there, including nothing: a cell written before
    // provenance existed stays unattributed rather than being credited to whoever next
    // saved the notebook around it.
    return unchanged
      ? { ...step, author: before.author }
      : { ...step, author: { by: writer, at } };
  });
}

export function stampAuthors(
  previous: NotebookJson | null,
  next: NotebookJson,
  writer: string,
  at: string = new Date().toISOString()
): NotebookJson {
  const before = new Map<string, NotebookCell>();
  indexCells(previous?.steps, before);
  return { ...next, steps: stampSteps(next.steps, before, writer, at) };
}

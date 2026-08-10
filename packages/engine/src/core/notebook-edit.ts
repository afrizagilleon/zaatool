import { randomUUID } from "crypto";
import type { NotebookCell, NotebookJson, NotebookStep } from "@zaa-tool/shared";
import { brokenReads } from "./notebook-outline.js";
import { codeSyntaxProblem, stripCodeFence } from "./cell-code.js";

/**
 * One cell at a time.
 *
 * `notebook_write` takes the whole document, which is the honest shape for a rewrite and
 * the wrong shape for a change. Adding a line to a twenty-cell notebook meant sending
 * nineteen cells back unaltered — and the measured failure mode was not the cost, it was
 * that a small model rewriting nineteen cells from memory does not reproduce them exactly.
 * `layout` and `actions` disappeared that way often enough to need their own fix in M17.
 *
 * So this exists to make the small change small. Nothing here is a shortcut around the
 * contract: an edit is applied, and then the whole document is judged the way any write is.
 */

export type CellEdit =
  | { action: "replace"; cell: string; code?: string; note?: string }
  | { action: "insert_after" | "insert_before"; cell: string; code: string; note?: string }
  | { action: "append"; code: string; note?: string }
  | { action: "delete"; cell: string }
  | { action: "add_lane"; cell: string; label?: string }
  | { action: "remove_lane"; cell: string; force?: boolean };

export class CellEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CellEditError";
  }
}

function newCell(code: string, note?: string): NotebookCell {
  return { id: randomUUID(), kind: "cell", code, ...(note ? { note } : {}) };
}

export function isLaneMatch(
  parallelId: string,
  lane: { id: string; label?: string },
  laneIdx: number,
  ref: string
): boolean {
  if (lane.id === ref) return true;
  const prefix = `${parallelId}/lane:`;
  if (ref.startsWith(prefix)) {
    const spec = ref.slice(prefix.length).trim();
    if (spec === lane.id) return true;
    if (lane.label && spec.toLowerCase() === lane.label.toLowerCase()) return true;
    const pos = Number(spec);
    if (Number.isInteger(pos) && pos === laneIdx + 1) return true;
  }
  if (lane.label && ref.toLowerCase() === lane.label.toLowerCase()) return true;
  return false;
}

/** Applies the edit wherever the cell lives, including inside a lane. */
function editSteps(steps: NotebookStep[], edit: CellEdit, done: { hit: boolean }): NotebookStep[] {
  const next: NotebookStep[] = [];

  for (const step of steps) {
    if (step.kind === "parallel") {
      if (edit.action === "add_lane" && step.id === edit.cell) {
        done.hit = true;
        const newLane = {
          id: randomUUID(),
          ...(edit.label ? { label: edit.label } : {}),
          steps: [],
        };
        next.push({
          ...step,
          lanes: [...(step.lanes ?? []), newLane],
        });
        continue;
      }

      if (edit.action === "remove_lane") {
        const lanes = step.lanes ?? [];
        const laneIndex = lanes.findIndex((lane, idx) => isLaneMatch(step.id, lane, idx, edit.cell));
        if (laneIndex !== -1) {
          done.hit = true;
          const targetLane = lanes[laneIndex];
          if ((targetLane.steps ?? []).length > 0 && !edit.force) {
            throw new CellEditError("Lane is not empty. Use force: true to remove a non-empty lane.");
          }
          next.push({
            ...step,
            lanes: lanes.filter((_, idx) => idx !== laneIndex),
          });
          continue;
        }
      }

      if (edit.action === "insert_before" || edit.action === "insert_after") {
        const lanes = step.lanes ?? [];
        const laneIndex = lanes.findIndex((lane, idx) => isLaneMatch(step.id, lane, idx, edit.cell));
        if (laneIndex !== -1 && (lanes[laneIndex].steps ?? []).length === 0) {
          done.hit = true;
          const newC = newCell(edit.code, edit.note);
          next.push({
            ...step,
            lanes: lanes.map((lane, idx) =>
              idx === laneIndex ? { ...lane, steps: [newC] } : lane
            ),
          });
          continue;
        }
      }

      next.push({
        ...step,
        lanes: (step.lanes ?? []).map((lane) => ({
          ...lane,
          steps: editSteps(lane.steps ?? [], edit, done),
        })),
      });
      continue;
    }

    if (
      edit.action === "append" ||
      edit.action === "add_lane" ||
      edit.action === "remove_lane" ||
      step.id !== edit.cell
    ) {
      next.push(step);
      continue;
    }

    done.hit = true;

    switch (edit.action) {
      case "replace":
        next.push({
          ...step,
          // Left alone when not given, so changing a note does not blank the code.
          ...(edit.code !== undefined ? { code: edit.code } : {}),
          ...(edit.note !== undefined ? { note: edit.note } : {}),
        });
        break;
      case "insert_before":
        next.push(newCell(edit.code, edit.note), step);
        break;
      case "insert_after":
        next.push(step, newCell(edit.code, edit.note));
        break;
      case "delete":
        break;
    }
  }

  return next;
}

/**
 * The document as it would be after the edit.
 *
 * Refuses two things and nothing else:
 *
 *  - **A cell that is not there.** Naming the wrong id must not silently do nothing, or an
 *    agent believes it made a change it did not make.
 *  - **A scope chain the edit would break.** Deleting the cell that writes `rows` when a
 *    later cell reads it is a notebook that now fails halfway through, and the failure
 *    would surface at 3am rather than here. Only *new* breaks are refused — a notebook
 *    that is already broken has to stay editable, or it cannot be repaired.
 */
export function applyCellEdit(document: NotebookJson, rawEdit: CellEdit): NotebookJson {
  /**
   * The code is cleaned and judged **before** anything is applied.
   *
   * A markdown fence is unwrapped rather than refused, because it is the most natural
   * thing a model can send and refusing it drove agents back to rewriting whole notebooks.
   * What is left has to parse: `compileNotebook` reads structure and never looked at a
   * line of code, which is how a cell containing nothing but a fence was stored, reported
   * as compiling, and only failed when somebody ran it.
   */
  const edit: CellEdit =
    "code" in rawEdit && rawEdit.code !== undefined
      ? { ...rawEdit, code: stripCodeFence(rawEdit.code) }
      : rawEdit;

  if ("code" in edit && edit.code !== undefined) {
    const problem = codeSyntaxProblem(edit.code, document.runtime);
    if (problem) throw new CellEditError(problem);
  }

  const done = { hit: edit.action === "append" };
  const steps = editSteps(document.steps ?? [], edit, done);

  if (!done.hit) {
    throw new CellEditError(
      `No cell with id "${(edit as { cell: string }).cell}". Read the notebook's outline to see the ids.`
    );
  }

  const edited: NotebookJson =
    edit.action === "append"
      ? { ...document, steps: [...steps, newCell(edit.code, edit.note)] }
      : { ...document, steps };

  const before = new Set(brokenReads(document).map((entry) => `${entry.cellId}:${entry.name}`));
  const introduced = brokenReads(edited).filter(
    (entry) => !before.has(`${entry.cellId}:${entry.name}`)
  );

  if (introduced.length > 0) {
    const described = introduced
      .map((entry) => `\`${entry.name}\` in cell \`${entry.cellId}\``)
      .join(", ");
    throw new CellEditError(
      `That edit leaves nothing writing ${described}. A cell reads a name off \`inputs\` that ` +
        `no earlier cell writes any more, so the notebook would fail partway through. Move the ` +
        `read, or write the name somewhere before it.`
    );
  }

  return edited;
}

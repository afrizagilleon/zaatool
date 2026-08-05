import type { NotebookJson, NotebookStep } from "@zaa-tool/shared";
import { outlineOf } from "./notebook-outline.js";

/**
 * What differs between what is deployed and what is being edited.
 *
 * `getDeployState` has always been able to say *that* a draft has moved on, and never
 * *what* moved. An agent asked to fix something in production therefore had two choices:
 * read both documents in full and compare them itself, or guess. Both are worse than a
 * list.
 *
 * Cells are matched by id, which is what makes this readable: a cell that moved is not
 * reported as one deletion and one addition, and a notebook whose ids were dropped by a
 * careless rewrite shows up honestly as everything replaced.
 */

interface CellChange {
  cellId: string;
  what: "added" | "removed" | "code" | "note" | "code and note";
}

function cellsById(document: NotebookJson): Map<string, { note?: string; code?: string }> {
  const found = new Map<string, { note?: string; code?: string }>();
  const walk = (steps: NotebookStep[] | undefined): void => {
    for (const step of steps ?? []) {
      if (step.kind === "parallel") {
        for (const lane of step.lanes ?? []) walk(lane.steps);
        continue;
      }
      found.set(step.id, { note: step.note, code: step.code });
    }
  };
  walk(document.steps);
  return found;
}

/** Front matter keys worth reporting. `id` is never interesting; `steps` is the cells. */
const KEYS = [
  "name",
  "runtime",
  "inputs",
  "outputs",
  "secrets",
  "packages",
  "triggers",
  "layout",
  "actions",
] as const;

export function renderDiff(deployed: NotebookJson, draft: NotebookJson): string {
  const before = cellsById(deployed);
  const after = cellsById(draft);

  const cellChanges: CellChange[] = [];
  for (const [id, cell] of after) {
    const was = before.get(id);
    if (!was) {
      cellChanges.push({ cellId: id, what: "added" });
      continue;
    }
    const codeChanged = (was.code ?? "") !== (cell.code ?? "");
    const noteChanged = (was.note ?? "") !== (cell.note ?? "");
    if (codeChanged && noteChanged) cellChanges.push({ cellId: id, what: "code and note" });
    else if (codeChanged) cellChanges.push({ cellId: id, what: "code" });
    else if (noteChanged) cellChanges.push({ cellId: id, what: "note" });
  }
  for (const id of before.keys()) {
    if (!after.has(id)) cellChanges.push({ cellId: id, what: "removed" });
  }

  const keyChanges: string[] = [];
  for (const key of KEYS) {
    const was = JSON.stringify(deployed[key] ?? null);
    const now = JSON.stringify(draft[key] ?? null);
    if (was === now) continue;
    keyChanges.push(`  ${key}: ${was} → ${now}`);
  }

  if (cellChanges.length === 0 && keyChanges.length === 0) {
    return `**${draft.name}** — the draft is exactly what is deployed.`;
  }

  const titles = new Map(outlineOf(draft).map((cell) => [cell.cellId, cell.title]));

  const lines = [`**${draft.name}** — draft against what is deployed`, ""];

  if (cellChanges.length > 0) {
    lines.push("cells:");
    for (const change of cellChanges) {
      const title = titles.get(change.cellId);
      lines.push(`  ${change.what.padEnd(13)} \`${change.cellId}\`${title ? ` — ${title}` : ""}`);
    }
  }

  if (keyChanges.length > 0) {
    if (cellChanges.length > 0) lines.push("");
    lines.push("declarations:", ...keyChanges);
  }

  lines.push(
    "",
    "Only a person can deploy. Nothing above is running until someone does."
  );

  return lines.join("\n");
}

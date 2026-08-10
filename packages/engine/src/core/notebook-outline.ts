import type { NotebookCell, NotebookJson, NotebookStep } from "@zaa-tool/shared";
import { cellReads, cellWrites, jsSyntaxProblem } from "./cell-analysis.js";
import { isLaneMatch } from "./notebook-edit.js";

export { cellReads, cellWrites };

/**
 * What each cell reads and what it writes, without running anything.
 *
 * Measured before this existed: reading a notebook costs about 214 tokens per cell, so a
 * twenty-cell notebook is ~4,300 tokens to read and the same again to write back — every
 * time an agent adds one line. The outline is the cheap answer to the question that
 * actually gets asked, which is *where does the thing I need to change live*.
 *
 * Both halves come from the cell's syntax tree — see `cell-analysis.ts` — and keep the
 * same honesty the map has about call edges: a `return` whose shape cannot be accounted
 * for is reported as unknown rather than as nothing. "Nothing" would be a lie that a
 * scope check could act on.
 */

export interface CellOutline {
  cellId: string;
  /** The lane this cell sits in, when it is inside a parallel group. */
  lane?: string;
  /** The note's first line — a person's own summary, which beats any generated one. */
  title: string;
  /** Names read off `inputs`. */
  reads: string[];
  /** Names the cell returns. */
  writes: string[];
  /**
   * False when the return could not be read — a computed key, a spread, a variable.
   * A caller deciding whether an edit breaks the chain must not treat this as "writes
   * nothing".
   */
  writesKnown: boolean;
  lines: number;
  /**
   * Set when the cell does not parse.
   *
   * JavaScript only — Python needs an interpreter, which an outline is not going to wait
   * for. A cell like this cannot run, and saying so here is cheaper than finding out at
   * 3am: a notebook whose fourth cell is broken looks perfectly healthy in every other
   * view of it.
   */
  syntaxError?: string;
}

function firstLine(note: string | undefined): string {
  if (!note) return "";
  for (const line of note.split("\n")) {
    const text = line.replace(/^#+\s*/, "").replace(/^>\s*/, "").trim();
    if (text) return text;
  }
  return "";
}

function outlineCell(cell: NotebookCell, runtime: string, lane?: string): CellOutline {
  const code = cell.code ?? "";
  const written = cellWrites(code);
  const syntaxError = runtime === "node" ? jsSyntaxProblem(code) : null;
  return {
    cellId: cell.id,
    ...(lane ? { lane } : {}),
    title: firstLine(cell.note),
    reads: cellReads(code),
    writes: written.names,
    writesKnown: written.known,
    lines: code.trim() === "" ? 0 : code.trim().split("\n").length,
    ...(syntaxError ? { syntaxError } : {}),
  };
}

/** One entry per cell, in the order they run, lanes flattened but labelled. */
export function outlineOf(document: NotebookJson): CellOutline[] {
  const outlines: CellOutline[] = [];

  const walk = (steps: NotebookStep[] | undefined, lane?: string): void => {
    for (const step of steps ?? []) {
      if (step.kind === "parallel") {
        for (const branch of step.lanes ?? []) {
          walk(branch.steps, branch.label || branch.id);
        }
        continue;
      }
      outlines.push(outlineCell(step, document.runtime, lane));
    }
  };

  walk(document.steps);
  return outlines;
}

/**
 * What is readable at each point, carried down the notebook.
 *
 * `certain` is what is definitely there. `uncertain` records that some earlier cell
 * returned a shape nobody could account for, so a name not in `certain` might still
 * arrive at run time and must not be reported as missing.
 */
interface Scope {
  certain: Set<string>;
  uncertain: boolean;
}

/**
 * Names that would be read by a cell and written by nobody before it.
 *
 * The check an edit has to pass, and it is deliberately conservative: it reports only
 * what it can prove. A cell whose writes could not be read makes everything *after it*
 * unprovable, so nothing downstream is reported — an edit is never refused on the
 * strength of a parse this file could not do.
 *
 * Two things that used to be wrong here:
 *
 *  - **Uncertainty was one flag for the whole document.** An opaque cell in lane A
 *    silenced the check in lane B, which cannot see lane A's writes at all. It is now
 *    carried in the scope, so it travels the way visibility travels.
 *  - **Almost every cell was opaque**, because the old character scanner could not read a
 *    ternary or an `await`. With a real parser the check is on far more of the time, which
 *    is the whole reason the distinction matters.
 *
 * Lanes run from the shared scope at the fork, because that is what the runner does — a
 * name written in one lane is not readable in another, and a check that pretended
 * otherwise would bless an edit the runner then refuses.
 */
export function brokenReads(document: NotebookJson): { cellId: string; name: string }[] {
  const broken: { cellId: string; name: string }[] = [];
  const declared = new Set((document.inputs ?? []).map((input) => input.name));

  // A trigger seeds `trigger` into scope before anything runs, and a caller may seed
  // whatever it likes — so an unresolved name is only reported when nothing could have
  // put it there.
  declared.add("trigger");

  const walk = (steps: NotebookStep[] | undefined, scope: Scope): Scope => {
    let current: Scope = { certain: new Set(scope.certain), uncertain: scope.uncertain };

    for (const step of steps ?? []) {
      if (step.kind === "parallel") {
        const merged: Scope = { certain: new Set(current.certain), uncertain: current.uncertain };
        for (const lane of step.lanes ?? []) {
          // Each lane starts from the fork, not from the lane before it.
          const after = walk(lane.steps, current);
          for (const name of after.certain) merged.certain.add(name);
          merged.uncertain = merged.uncertain || after.uncertain;
        }
        current = merged;
        continue;
      }

      const code = step.code ?? "";
      for (const name of cellReads(code)) {
        if (!current.certain.has(name) && !current.uncertain) {
          broken.push({ cellId: step.id, name });
        }
      }

      const written = cellWrites(code);
      if (!written.known) current.uncertain = true;
      for (const name of written.names) current.certain.add(name);
    }

    return current;
  };

  walk(document.steps, { certain: declared, uncertain: false });
  return broken;
}

/**
 * Every name readable at a given cell, and what cells after it still need.
 *
 * This is what makes `notebook_read(part: "cell")` safe to use on its own. An agent that
 * reads one cell knows its code and nothing else — and the one thing it cannot guess is
 * which names exist at that point. Without this it would guess, `brokenReads` would refuse
 * the edit, and it would guess again.
 */
export function scopeAt(
  document: NotebookJson,
  cellId: string
): { available: string[]; uncertain: boolean; neededAfter: string[] } | null {
  const cells = outlineOf(document);
  const index = cells.findIndex((cell) => cell.cellId === cellId);
  if (index === -1) return null;

  const available = new Set((document.inputs ?? []).map((input) => input.name));
  available.add("trigger");
  let uncertain = false;

  for (const cell of cells.slice(0, index)) {
    for (const name of cell.writes) available.add(name);
    if (!cell.writesKnown) uncertain = true;
  }

  // What this cell must keep writing, or something below it stops working.
  const neededAfter = new Set<string>();
  for (const cell of cells.slice(index + 1)) {
    for (const name of cell.reads) {
      if (cells[index].writes.includes(name)) neededAfter.add(name);
    }
  }
  // A declared output this cell produces is needed by the page, not by another cell.
  const outputs = new Set(
    (document.outputs ?? []).map((output) => (typeof output === "string" ? output : output.name))
  );
  for (const name of cells[index].writes) {
    if (outputs.has(name)) neededAfter.add(name);
  }

  return { available: [...available], uncertain, neededAfter: [...neededAfter] };
}

function hasParallelOrLane(steps: NotebookStep[] | undefined, ref: string): boolean {
  for (const step of steps ?? []) {
    if (step.kind === "parallel") {
      if (step.id === ref) return true;
      const lanes = step.lanes ?? [];
      for (let idx = 0; idx < lanes.length; idx++) {
        if (isLaneMatch(step.id, lanes[idx], idx, ref)) return true;
        if (hasParallelOrLane(lanes[idx].steps, ref)) return true;
      }
    }
  }
  return false;
}

/** Resolves a cell by id or by its 1-based position, the way `notebook_run_cell` does. */
export function findCell(document: NotebookJson, reference: string): string | null {
  const cells = outlineOf(document);
  const trimmed = reference.trim();
  if (cells.some((cell) => cell.cellId === trimmed)) return trimmed;

  const position = Number(trimmed);
  if (Number.isInteger(position) && position >= 1 && position <= cells.length) {
    return cells[position - 1].cellId;
  }

  if (hasParallelOrLane(document.steps, trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * One cell, with enough of its surroundings to edit it safely.
 *
 * The code alone would be a trap. An agent reading a single cell knows what that cell
 * does and nothing about the notebook around it — so the two things it cannot guess are
 * *which names exist here* and *which names something below still needs*. Both are
 * already computed for the outline; this is them, attached to the one cell being read.
 */
export function renderCell(document: NotebookJson, reference: string): string | null {
  const cellId = findCell(document, reference);
  if (!cellId) return null;

  const cells = outlineOf(document);
  const index = cells.findIndex((cell) => cell.cellId === cellId);
  const outline = cells[index];
  const scope = scopeAt(document, cellId);

  const source = (() => {
    const found: NotebookCell[] = [];
    const walk = (steps: NotebookStep[] | undefined): void => {
      for (const step of steps ?? []) {
        if (step.kind === "parallel") {
          for (const lane of step.lanes ?? []) walk(lane.steps);
          continue;
        }
        if (step.id === cellId) found.push(step);
      }
    };
    walk(document.steps);
    return found[0];
  })();

  const lines = [
    `**${document.name}** · cell ${index + 1} of ${cells.length} · \`${cellId}\`` +
      (outline.lane ? ` · lane ${outline.lane}` : ""),
  ];

  if (source?.note?.trim()) {
    lines.push("", "note:", ...source.note.split("\n").map((line) => `  ${line}`));
  }

  lines.push("", "code:", ...(source?.code ?? "").split("\n").map((line) => `  ${line}`));

  lines.push(
    "",
    `in scope here: ${scope?.available.join(", ") || "nothing"}` +
      (scope?.uncertain ? " (and possibly more — an earlier cell returns a shape that cannot be read)" : ""),
    `this cell writes: ${outline.writes.join(", ") || "nothing"}` +
      (outline.writesKnown ? "" : " (and more that cannot be read)")
  );

  if (scope?.neededAfter.length) {
    lines.push(
      `must keep writing: ${scope.neededAfter.join(", ")} — a later cell or a declared output depends on ${scope.neededAfter.length === 1 ? "it" : "them"}`
    );
  }

  lines.push(
    "",
    `Change it with notebook_edit_cell(notebook: "${document.name}", action: "replace", cell: "${cellId}", code: …)`
  );

  return lines.join("\n");
}

/** The outline as an agent reads it: one line per cell, and nothing it did not ask for. */
export function renderOutline(document: NotebookJson): string {
  const cells = outlineOf(document);
  if (cells.length === 0) return "This notebook has no cells.";

  const lines: string[] = [];
  const contract = [
    (document.inputs ?? []).map((input) => input.name).join(", ") || "no inputs",
    (document.outputs ?? [])
      .map((output) => (typeof output === "string" ? output : output.name))
      .join(", ") || "nothing",
  ];
  lines.push(`**${document.name}** \`${document.id}\` · ${document.runtime}`);
  lines.push(`(${contract[0]}) → {${contract[1]}}`);
  lines.push("");

  for (const cell of cells) {
    const writes = cell.writesKnown
      ? cell.writes.join(", ") || "nothing"
      : `${cell.writes.join(", ") || "?"} (and more it could not read)`;
    const where = cell.lane ? ` · lane ${cell.lane}` : "";
    const broken = cell.syntaxError ? " · DOES NOT PARSE" : "";
    lines.push(`- \`${cell.cellId}\`${where} · ${cell.lines} line(s)${broken}`);
    if (cell.title) lines.push(`    ${cell.title}`);
    lines.push(`    reads: ${cell.reads.join(", ") || "nothing"} → writes: ${writes}`);
    // Named here because every other view of the notebook looks perfectly healthy, and
    // the alternative is finding out when it runs.
    if (cell.syntaxError) lines.push(`    ${cell.syntaxError}`);
  }

  return lines.join("\n");
}

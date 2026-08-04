import type { NotebookCell, NotebookJson, NotebookStep } from "@zaa-tool/shared";

/**
 * What each cell reads and what it writes, without running anything.
 *
 * Measured before this existed: reading a notebook costs about 214 tokens per cell, so a
 * twenty-cell notebook is ~4,300 tokens to read and the same again to write back — every
 * time an agent adds one line. The outline is the cheap answer to the question that
 * actually gets asked, which is *where does the thing I need to change live*.
 *
 * Both halves are read out of the source text, the same way the map reads call edges, and
 * with the same honesty about it: a `return` this cannot parse is reported as unknown
 * rather than as nothing. "Nothing" would be a lie that a scope check could act on.
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
}

/** Names a cell takes off the shared scope. */
export function cellReads(code: string): string[] {
  const names = new Set<string>();
  for (const match of code.matchAll(/inputs\s*\.\s*([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of code.matchAll(/inputs\s*\[\s*["']([^"']+)["']\s*\]/g)) names.add(match[1]);
  return [...names];
}

/**
 * Names a cell returns.
 *
 * Walks the object literal after `return` rather than matching a pattern across it, so a
 * nested object, a string containing a brace, or a comment does not produce a phantom
 * name. Anything it cannot account for sets `known` to false.
 */
export function cellWrites(code: string): { names: string[]; known: boolean } {
  const start = findReturnObject(code);
  if (start === -1) return { names: [], known: false };

  const names: string[] = [];
  let known = true;
  let depth = 0;
  let index = start;
  let atKey = true;

  while (index < code.length) {
    const character = code[index];

    if (character === '"' || character === "'" || character === "`") {
      const end = skipString(code, index);
      if (depth === 1 && atKey) {
        const name = code.slice(index + 1, end - 1);
        if (isKeyed(code, end)) {
          names.push(name);
          atKey = false;
        }
      }
      index = end;
      continue;
    }

    if (character === "{" || character === "[" || character === "(") {
      depth += 1;
      index += 1;
      if (depth === 1) atKey = true;
      continue;
    }

    if (character === "}" || character === "]" || character === ")") {
      depth -= 1;
      index += 1;
      if (depth === 0) break;
      continue;
    }

    if (depth === 1 && character === ",") {
      atKey = true;
      index += 1;
      continue;
    }

    if (depth === 1 && atKey) {
      // A spread carries names this cannot see, and the honest answer is "unknown".
      if (code.startsWith("...", index)) {
        known = false;
        atKey = false;
        index += 3;
        continue;
      }
      // A computed key, same reason.
      if (character === "[") {
        known = false;
        atKey = false;
        index += 1;
        continue;
      }

      const identifier = /^[A-Za-z_$][\w$]*/.exec(code.slice(index));
      if (identifier) {
        const after = index + identifier[0].length;
        const next = nextMeaningful(code, after);
        if (next === ":" || next === "," || next === "}") {
          names.push(identifier[0]);
          atKey = false;
        }
        index = after;
        continue;
      }
    }

    index += 1;
  }

  return { names: [...new Set(names)], known };
}

/** The index of the `{` opening the returned object, or -1 if there is not one. */
function findReturnObject(code: string): number {
  for (const match of code.matchAll(/\breturn\b/g)) {
    let index = (match.index ?? 0) + match[0].length;
    while (index < code.length && /\s/.test(code[index])) index += 1;
    if (code[index] === "{") return index;
  }
  return -1;
}

function skipString(code: string, start: number): number {
  const quote = code[start];
  let index = start + 1;
  while (index < code.length) {
    if (code[index] === "\\") index += 2;
    else if (code[index] === quote) return index + 1;
    else index += 1;
  }
  return code.length;
}

function nextMeaningful(code: string, from: number): string {
  let index = from;
  while (index < code.length && /\s/.test(code[index])) index += 1;
  return code[index] ?? "";
}

/** Whether a quoted string was a key (`"a": 1`) rather than a value. */
function isKeyed(code: string, after: number): boolean {
  return nextMeaningful(code, after) === ":";
}

function firstLine(note: string | undefined): string {
  if (!note) return "";
  for (const line of note.split("\n")) {
    const text = line.replace(/^#+\s*/, "").replace(/^>\s*/, "").trim();
    if (text) return text;
  }
  return "";
}

function outlineCell(cell: NotebookCell, lane?: string): CellOutline {
  const code = cell.code ?? "";
  const written = cellWrites(code);
  return {
    cellId: cell.id,
    ...(lane ? { lane } : {}),
    title: firstLine(cell.note),
    reads: cellReads(code),
    writes: written.names,
    writesKnown: written.known,
    lines: code.trim() === "" ? 0 : code.trim().split("\n").length,
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
      outlines.push(outlineCell(step, lane));
    }
  };

  walk(document.steps);
  return outlines;
}

/**
 * Names that would be read by a cell and written by nobody before it.
 *
 * The check an edit has to pass. Deliberately conservative in both directions: a cell
 * whose writes could not be read contributes its unknowns to *everything* after it, so an
 * edit is never refused on the strength of a parse this file could not do.
 *
 * Lanes are treated as running from the shared scope at the fork, because they do — a
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

  let anyUnknown = false;

  const walk = (steps: NotebookStep[] | undefined, scope: Set<string>): Set<string> => {
    let current = new Set(scope);

    for (const step of steps ?? []) {
      if (step.kind === "parallel") {
        const merged = new Set(current);
        for (const lane of step.lanes ?? []) {
          for (const name of walk(lane.steps, current)) merged.add(name);
        }
        current = merged;
        continue;
      }

      const code = step.code ?? "";
      for (const name of cellReads(code)) {
        if (!current.has(name) && !anyUnknown) broken.push({ cellId: step.id, name });
      }

      const written = cellWrites(code);
      if (!written.known) anyUnknown = true;
      for (const name of written.names) current.add(name);
    }

    return current;
  };

  walk(document.steps, declared);
  return broken;
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
    lines.push(`- \`${cell.cellId}\`${where} · ${cell.lines} line(s)`);
    if (cell.title) lines.push(`    ${cell.title}`);
    lines.push(`    reads: ${cell.reads.join(", ") || "nothing"} → writes: ${writes}`);
  }

  return lines.join("\n");
}

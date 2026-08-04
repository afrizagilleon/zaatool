import type {
  NotebookJson,
  NotebookMap,
  NotebookMapCall,
  NotebookMapNotebook,
  NotebookMapTrigger,
  NotebookParam,
  NotebookStep,
} from "@zaa-tool/shared";
import { outputNames } from "./notebook-outputs.js";

/**
 * Builds the system map from the documents.
 *
 * A pure function on purpose: no database, no HTTP, no notion of who is asking. The
 * browser renders what this returns and an agent reads the same thing over MCP, so
 * there is one answer to "what does this system look like" rather than two that drift.
 *
 * The interesting part is the call edges. A notebook does not declare who it calls —
 * that would be a second thing to keep in step with the code — so they are read out of
 * the code itself. Which means this is a *reading*, not a proof, and it says so: a call
 * whose target is computed at run time is reported as dynamic rather than dropped.
 */

/** `notebooks.run("name")` with a literal name — the form that can be resolved. */
const LITERAL_CALL = /notebooks\s*\.\s*run\s*\(\s*(['"`])([^'"`]*)\1/g;
/** Any `notebooks.run(` at all, so computed targets can be counted and reported. */
const ANY_CALL = /notebooks\s*\.\s*run\s*\(/g;

function countMatches(source: string, pattern: RegExp): number {
  const matcher = new RegExp(pattern.source, pattern.flags);
  let count = 0;
  while (matcher.exec(source) !== null) count += 1;
  return count;
}

interface CellSource {
  cellId: string;
  code: string;
}

function collectCells(steps: NotebookStep[] | undefined, into: CellSource[], counts: { parallel: number }): void {
  for (const step of steps ?? []) {
    if (step.kind === "parallel") {
      counts.parallel += 1;
      for (const lane of step.lanes ?? []) collectCells(lane.steps, into, counts);
      continue;
    }
    if (typeof step.code === "string" && step.code.trim()) {
      into.push({ cellId: step.id, code: step.code });
    }
  }
}

function describeInput(input: NotebookParam): string {
  return `${input.name}: ${input.type}${input.required ? "!" : ""}`;
}

/**
 * Resolves a call's target the same way the engine does at run time — id first, then
 * name — so the map agrees with what would actually happen.
 */
function resolveTarget(
  reference: string,
  byId: Map<string, NotebookJson>,
  byName: Map<string, NotebookJson[]>
): { toNotebookId: string | null; resolved: boolean; ambiguous: boolean } {
  const byIdMatch = byId.get(reference);
  if (byIdMatch) return { toNotebookId: byIdMatch.id, resolved: true, ambiguous: false };

  const named = byName.get(reference) ?? [];
  if (named.length === 1) return { toNotebookId: named[0].id, resolved: true, ambiguous: false };
  if (named.length > 1) return { toNotebookId: null, resolved: false, ambiguous: true };
  return { toNotebookId: null, resolved: false, ambiguous: false };
}

export function buildNotebookMap(
  documents: { document: NotebookJson; updatedAt: string }[]
): NotebookMap {
  const byId = new Map<string, NotebookJson>();
  const byName = new Map<string, NotebookJson[]>();
  for (const { document } of documents) {
    byId.set(document.id, document);
    const sameName = byName.get(document.name) ?? [];
    sameName.push(document);
    byName.set(document.name, sameName);
  }

  const notebooks: NotebookMapNotebook[] = [];
  const triggers: NotebookMapTrigger[] = [];
  const calls: NotebookMapCall[] = [];

  for (const { document, updatedAt } of documents) {
    const cells: CellSource[] = [];
    const counts = { parallel: 0 };
    collectCells(document.steps, cells, counts);

    notebooks.push({
      id: document.id,
      name: document.name,
      runtime: document.runtime,
      inputs: (document.inputs ?? []).map(describeInput),
      outputs: outputNames(document.outputs),
      secrets: [...(document.secrets ?? [])],
      cellCount: cells.length,
      parallelCount: counts.parallel,
      updatedAt,
    });

    for (const trigger of document.triggers ?? []) {
      triggers.push({
        id: trigger.id,
        notebookId: document.id,
        kind: trigger.kind,
        label: trigger.kind === "cron" ? trigger.cron : `/hooks/${trigger.slug}`,
        enabled: trigger.enabled !== false,
      });
    }

    for (const cell of cells) {
      const matcher = new RegExp(LITERAL_CALL.source, LITERAL_CALL.flags);
      let literals = 0;
      let match: RegExpExecArray | null;

      while ((match = matcher.exec(cell.code)) !== null) {
        literals += 1;
        const reference = match[2];
        calls.push({
          fromNotebookId: document.id,
          fromCellId: cell.cellId,
          reference,
          dynamic: false,
          ...resolveTarget(reference, byId, byName),
        });
      }

      // Whatever is left over called `notebooks.run` with something this cannot read.
      const unresolvable = countMatches(cell.code, ANY_CALL) - literals;
      for (let index = 0; index < unresolvable; index += 1) {
        calls.push({
          fromNotebookId: document.id,
          fromCellId: cell.cellId,
          reference: "(computed)",
          toNotebookId: null,
          resolved: false,
          dynamic: true,
          ambiguous: false,
        });
      }
    }
  }

  return { notebooks, triggers, calls };
}

/** The same map as a paragraph, for an agent that asked what exists. */
export interface MapRenderOptions {
  /** Only notebooks mentioning this word in their name, contract or triggers. */
  about?: string;
  /** Group by how each notebook is reached rather than listing them flat. */
  grouped?: boolean;
}

export function renderNotebookMap(map: NotebookMap, options: MapRenderOptions = {}): string {
  if (map.notebooks.length === 0) return "No notebooks yet.";

  const triggersFor = (notebookId: string) =>
    map.triggers.filter((trigger) => trigger.notebookId === notebookId);
  const callsFrom = (notebookId: string) =>
    map.calls.filter((call) => call.fromNotebookId === notebookId);
  const callersOf = (notebookId: string) =>
    map.calls.filter((call) => call.toNotebookId === notebookId);
  const nameOf = (notebookId: string) =>
    map.notebooks.find((notebook) => notebook.id === notebookId)?.name ?? notebookId;

  /**
   * Matched against what a person would search for, which is a name, an argument or a
   * schedule — never the code. Searching the code would turn the map into a grep with a
   * worse interface, and the map's job is the shape of the system.
   */
  const mentions = (notebook: NotebookMap["notebooks"][number]): boolean => {
    const needle = options.about?.trim().toLowerCase();
    if (!needle) return true;
    const haystack = [
      notebook.name,
      ...notebook.inputs,
      ...notebook.outputs,
      ...triggersFor(notebook.id).map((trigger) => `${trigger.kind} ${trigger.label}`),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  };

  const shown = map.notebooks.filter(mentions);
  if (shown.length === 0) {
    return `Nothing in this workspace mentions "${options.about}".`;
  }

  const lines: string[] = [];

  const describe = (notebook: NotebookMap["notebooks"][number]): void => {
    lines.push(`- **${notebook.name}** \`${notebook.id}\` · ${notebook.runtime} · ${notebook.cellCount} cell(s)`);
    if (notebook.inputs.length > 0 || notebook.outputs.length > 0) {
      lines.push(`    (${notebook.inputs.join(", ") || "no inputs"}) → {${notebook.outputs.join(", ") || "nothing"}}`);
    }
    for (const trigger of triggersFor(notebook.id)) {
      lines.push(`    ${trigger.kind} ${trigger.label}${trigger.enabled ? "" : " (disabled)"}`);
    }
    for (const call of callsFrom(notebook.id)) {
      const target = call.resolved && call.toNotebookId ? nameOf(call.toNotebookId) : call.reference;
      const note = call.dynamic
        ? " — target computed at run time"
        : call.ambiguous
          ? " — more than one notebook has this name"
          : call.resolved
            ? ""
            : " — no such notebook";
      lines.push(`    calls ${target}${note}`);
    }
    const callers = callersOf(notebook.id);
    if (callers.length > 0) {
      const names = [...new Set(callers.map((call) => nameOf(call.fromNotebookId)))];
      lines.push(`    called by ${names.join(", ")}`);
    }
  };

  if (!options.grouped) {
    for (const notebook of shown) describe(notebook);
    return lines.join("\n");
  }

  /**
   * Three groups, and the middle one is why this exists.
   *
   * A notebook that is only ever called by another is a *function*: it is the thing to
   * look for before writing anything, and in a flat list it sits between two schedules
   * looking exactly like them. Sorting by how a notebook is reached is the difference
   * between a list of files and a description of a system.
   */
  const entryPoints = shown.filter((notebook) => triggersFor(notebook.id).length > 0);
  const reused = shown.filter(
    (notebook) => triggersFor(notebook.id).length === 0 && callersOf(notebook.id).length > 0
  );
  const idle = shown.filter(
    (notebook) => triggersFor(notebook.id).length === 0 && callersOf(notebook.id).length === 0
  );

  const section = (title: string, group: typeof shown, note: string): void => {
    if (group.length === 0) return;
    if (lines.length > 0) lines.push("");
    lines.push(`## ${title} — ${note}`);
    for (const notebook of group) describe(notebook);
  };

  section("Starts on its own", entryPoints, "a schedule or a webhook sets these off");
  section("Called by others", reused, "these exist to be reused — check here before writing");
  section("Neither", idle, "run by hand, or not finished");

  return lines.join("\n");
}

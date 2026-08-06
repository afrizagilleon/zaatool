import type { NotebookMap } from "./notebook-map.js";

/**
 * How a notebook is reached, which is the only useful way to sort a system.
 *
 * Three answers, and the middle one is why this exists. A notebook that is only ever
 * called by another is a *function*: it is the thing to look for before writing anything
 * new, and in a flat list it sits between two schedules looking exactly like them.
 *
 * This rule was written once for the agent's text output and never for the map on screen,
 * so the canvas drew one undifferentiated heap while `notebook_about` described a system
 * in three parts. That is not two features; it is one rule with one renderer missing. It
 * lives here now because both readers need it and neither may own it.
 */

export type MapRole =
  /** A schedule or a webhook sets these off. Where you start reading. */
  | "entry"
  /** Called by another notebook. These exist to be reused. */
  | "reused"
  /** Run by hand, or not finished. */
  | "idle";

export const MAP_ROLE_LABELS: Record<MapRole, string> = {
  entry: "Starts on its own",
  reused: "Called by others",
  idle: "Neither",
};

export const MAP_ROLE_NOTES: Record<MapRole, string> = {
  entry: "a schedule or a webhook sets these off",
  reused: "these exist to be reused — check here before writing",
  idle: "run by hand, or not finished",
};

/** The order they are read in: what starts, what it reaches, what it does not. */
export const MAP_ROLE_ORDER: MapRole[] = ["entry", "reused", "idle"];

/**
 * The role of every notebook in the map, by id.
 *
 * A disabled trigger still counts as one. Something with a schedule switched off is not
 * a loose notebook somebody forgot — it is an entry point that is currently paused, and
 * moving it into "Neither" would hide the very thing you came to check.
 *
 * A call from a notebook to itself does not make it "called by others"; recursion is not
 * a caller.
 */
export function mapRoles(map: NotebookMap): Map<string, MapRole> {
  const triggered = new Set(map.triggers.map((trigger) => trigger.notebookId));
  const called = new Set(
    map.calls
      .filter((call) => call.toNotebookId && call.toNotebookId !== call.fromNotebookId)
      .map((call) => call.toNotebookId as string)
  );

  const roles = new Map<string, MapRole>();
  for (const notebook of map.notebooks) {
    roles.set(
      notebook.id,
      triggered.has(notebook.id) ? "entry" : called.has(notebook.id) ? "reused" : "idle"
    );
  }
  return roles;
}

/**
 * Whether a notebook is joined to anything at all — a trigger, a call in, a call out.
 *
 * Separate from its role because they answer different questions. "Neither" is about how
 * it is *reached*; this is about whether drawing it among arrows tells you anything. A
 * notebook that calls another has no role beyond "idle" and still belongs on the graph,
 * because the arrow leaving it is a fact about the system.
 */
export function connectedNotebooks(map: NotebookMap): Set<string> {
  const joined = new Set<string>(map.triggers.map((trigger) => trigger.notebookId));
  for (const call of map.calls) {
    joined.add(call.fromNotebookId);
    if (call.toNotebookId) joined.add(call.toNotebookId);
  }
  return joined;
}

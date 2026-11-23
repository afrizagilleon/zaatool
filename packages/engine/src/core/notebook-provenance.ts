import type { CellAuthor, NotebookCell, NotebookJson, NotebookStep } from "@zaa-tool/shared";
import type { Actor } from "./actor.js";

/**
 * Who is writing, in the form a cell's `author` takes.
 *
 * `by` is the name to show and stays the only thing older documents have. The rest says what
 * that name is, so an agent labelled "alice" is never mistaken for the user `alice`.
 */
export interface Writer {
  by: string;
  kind?: "user" | "agent";
  userId?: string;
  tokenId?: string;
}

/**
 * Types a writer from the actor the request was authenticated as. `by` is still what the
 * caller chose to display (the username or the token's label); the actor, which only a guard
 * can set, supplies `kind` and the ids. With no actor (a script calling the service) there
 * is nothing to add and the stamp is the old two-field one.
 */
export function writerFor(by: string, actor: Actor | undefined): Writer {
  if (actor?.type === "user") return { by, kind: "user", userId: actor.userId };
  if (actor?.type === "agent") return { by, kind: "agent", userId: actor.userId, tokenId: actor.tokenId };
  return { by };
}

function authorOf(writer: Writer, at: string): CellAuthor {
  return {
    by: writer.by,
    at,
    ...(writer.kind ? { kind: writer.kind } : {}),
    ...(writer.userId ? { userId: writer.userId } : {}),
    ...(writer.tokenId ? { tokenId: writer.tokenId } : {}),
  };
}

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
  writer: Writer,
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
      : { ...step, author: authorOf(writer, at) };
  });
}

export function stampAuthors(
  previous: NotebookJson | null,
  next: NotebookJson,
  writer: string | Writer,
  at: string = new Date().toISOString()
): NotebookJson {
  const before = new Map<string, NotebookCell>();
  indexCells(previous?.steps, before);
  const who: Writer = typeof writer === "string" ? { by: writer } : writer;
  return { ...next, steps: stampSteps(next.steps, before, who, at) };
}

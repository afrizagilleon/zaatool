import type { NotebookJson, NotebookLayoutItem } from "@zaa-tool/shared";
import { outputSpecs } from "./notebook-outputs.js";

/**
 * Front matter, on its own.
 *
 * Everything a notebook declares — `inputs`, `outputs`, `layout`, `triggers`, `secrets`,
 * `packages`, `actions` — lives in front matter, and until now the only tool that could
 * touch any of it was `notebook_write`, which asks for the whole document. So moving one
 * tile on a page meant reproducing every cell from memory. That is not a token problem,
 * it is how cells came back subtly different from what was stored.
 *
 * One key at a time, then, and read the same way: `part: setup` answers with the
 * declaration and not a line of code.
 */

/** The keys that may be read and written this way. Deliberately not `id`, and not `steps`. */
export const SETUP_KEYS = [
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

export type SetupKey = (typeof SETUP_KEYS)[number];

export class SetupEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupEditError";
  }
}

/** Keys whose value is a list; anything else sent for them is a mistake worth naming. */
const LIST_KEYS = new Set<SetupKey>([
  "inputs",
  "outputs",
  "secrets",
  "packages",
  "triggers",
  "layout",
  "actions",
]);

/**
 * Reads the value an agent sent.
 *
 * JSON first, because that is what a list has to be. A bare word is accepted for the two
 * scalar keys, since `name: my-notebook` is what anyone would type and refusing it would
 * be pedantry rather than safety.
 */
export function parseSetupValue(key: SetupKey, raw: string): unknown {
  const text = String(raw ?? "").trim();

  try {
    return JSON.parse(text);
  } catch {
    if (LIST_KEYS.has(key)) {
      throw new SetupEditError(
        `\`${key}\` takes a JSON list, and that is not valid JSON. Send it as, for example: ` +
          `[{"name":"pair","type":"string"}]  — or [] to clear it.`
      );
    }
    // `name` and `runtime`: a bare word is the obvious form.
    return text.replace(/^["']|["']$/g, "");
  }
}

/**
 * The document with one declaration replaced.
 *
 * Shape is checked here only far enough to give a useful message; the real judgement is
 * the caller's, which round-trips the whole document through the same parser
 * `notebook_write` uses. One validation path, no back doors.
 */
export function applySetupEdit(document: NotebookJson, key: SetupKey, value: unknown): NotebookJson {
  if (LIST_KEYS.has(key) && !Array.isArray(value)) {
    throw new SetupEditError(`\`${key}\` must be a list. Send [] to clear it.`);
  }

  if (key === "runtime" && value !== "node" && value !== "python") {
    throw new SetupEditError("`runtime` is `node` or `python`.");
  }

  if (key === "name") {
    const name = String(value ?? "").trim();
    if (name === "") throw new SetupEditError("`name` cannot be empty.");
    return { ...document, name };
  }

  // An empty list means "there are none", which is different from "leave it alone" —
  // and the difference is the whole reason `layout` and `actions` survive a rewrite.
  const next: NotebookJson = { ...document, [key]: value } as NotebookJson;
  if (Array.isArray(value) && value.length === 0) {
    delete (next as unknown as Record<string, unknown>)[key];
  }

  return next;
}

/** How wide the page grid is. Fixed by the renderer; nothing declares it. */
const COLUMNS = 12;

/**
 * The arrangement, drawn.
 *
 * `[{i:"total",x:0,y:0,w:6,h:4}, …]` is unreadable as a picture, and a picture is what
 * anybody moving a tile is actually holding in their head. This is the reason a single
 * `notebook_edit_setup` is enough and a separate layout tool is not: layout is hard to
 * *read*, not hard to write.
 */
export function renderLayout(document: NotebookJson): string {
  const layout = document.layout ?? [];
  const outputs = outputSpecs(document.outputs).map((output) => output.name);

  if (layout.length === 0) {
    return outputs.length === 0
      ? "No outputs, so nothing to arrange."
      : `No arrangement — the page lays out ${outputs.length} output(s) by itself, in order.`;
  }

  const rows = Math.max(...layout.map((item) => item.y + item.h));
  const grid: string[][] = Array.from({ length: rows }, () => Array(COLUMNS).fill("·"));

  // One letter per tile, in declaration order, so the legend below is short.
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const legend: string[] = [];

  layout.forEach((item, index) => {
    const mark = letters[index] ?? "?";
    legend.push(`${mark} = ${item.i}  (x${item.x} y${item.y} w${item.w} h${item.h})`);
    for (let y = item.y; y < item.y + item.h && y < rows; y += 1) {
      for (let x = item.x; x < item.x + item.w && x < COLUMNS; x += 1) {
        // A cell already taken means two tiles overlap, which the page will resolve by
        // pushing one down — worth seeing rather than discovering later.
        grid[y][x] = grid[y][x] === "·" ? mark : "!";
      }
    }
  });

  const picture = grid.map((row) => `  |${row.join("")}|`).join("\n");
  const orphans = layout.filter((item) => !outputs.includes(item.i));

  return [
    `  ${"0123456789".slice(0, 10)}11   ← 12 columns`,
    picture,
    "",
    ...legend.map((line) => `  ${line}`),
    ...(grid.some((row) => row.includes("!"))
      ? ["", "  ! = two tiles overlap here."]
      : []),
    ...(orphans.length > 0
      ? ["", `  Points at nothing: ${orphans.map((item) => item.i).join(", ")}`]
      : []),
  ].join("\n");
}

/** Front matter as an agent reads it, with the layout drawn rather than dumped. */
export function renderSetup(document: NotebookJson): string {
  const lines: string[] = [
    `**${document.name}** \`${document.id}\` · ${document.runtime}`,
    "",
  ];

  const list = (label: string, values: unknown[] | undefined): void => {
    if (!values || values.length === 0) {
      lines.push(`${label}: none`);
      return;
    }
    lines.push(`${label}:`);
    for (const value of values) {
      lines.push(`  ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  };

  list("inputs", document.inputs);
  list("outputs", document.outputs);
  list("secrets", document.secrets);
  list("packages", document.packages);
  list("triggers", document.triggers);
  list("actions", document.actions);

  lines.push("", "layout:", renderLayout(document));
  lines.push(
    "",
    "Change one of these with `notebook_edit_setup`. Nothing here touches a cell.",
    "The raw value of any key is what `notebook_read part: full` shows in front matter."
  );

  return lines.join("\n");
}

/** A layout item, checked far enough to say what is wrong with it. */
export function layoutProblems(value: unknown): string[] {
  if (!Array.isArray(value)) return ["`layout` must be a list."];
  const issues: string[] = [];

  value.forEach((raw, index) => {
    const item = raw as Partial<NotebookLayoutItem>;
    if (typeof item?.i !== "string" || item.i.trim() === "") {
      issues.push(`layout[${index}] has no \`i\` — that is the output's name.`);
      return;
    }
    for (const field of ["x", "y", "w", "h"] as const) {
      if (typeof item[field] !== "number" || !Number.isFinite(item[field])) {
        issues.push(`layout[${index}] (${item.i}) has no numeric \`${field}\`.`);
      }
    }
    if (typeof item.x === "number" && typeof item.w === "number" && item.x + item.w > COLUMNS) {
      issues.push(`layout[${index}] (${item.i}) runs past column ${COLUMNS}.`);
    }
  });

  return issues;
}

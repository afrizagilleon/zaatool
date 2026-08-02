/**
 * Shortening what a run reports back to an agent.
 *
 * Until this existed, a run reply carried every output and every cell result verbatim.
 * A notebook returning ninety-three rows spent tens of thousands of tokens of the
 * agent's context on data it had just produced itself, every single time it ran — and a
 * notebook returning a million rows ended the session.
 *
 * The fix is not to send less information. It is to send a *different* kind: an agent
 * deciding what to do next needs the shape and the size, not the contents. "93 rows ×
 * 8 columns, here are three" answers more questions than ninety-three rows do, and it
 * is the only form that keeps answering when the number is a million.
 *
 * This is presentation for one audience, so it lives beside the tools rather than in
 * `core/` — nothing that runs or stores a notebook abridges anything.
 */

/** Rows kept from a table, enough to show the shape without becoming the table. */
const SAMPLE_ROWS = 3;
/** Items kept from a plain list. */
const SAMPLE_ITEMS = 5;
/** Past this a string is prose or a dump, and the beginning is the useful part. */
const MAX_STRING = 800;
/** Objects with more keys than this are data pretending to be a record. */
const MAX_KEYS = 40;
/** Deep enough for a real result, shallow enough to stop a cycle of nesting. */
const MAX_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rows of the same kind — the shape worth describing rather than listing. */
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  }
  return columns;
}

export function abridge(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === "string") {
    if (value.length <= MAX_STRING) return value;
    return `${value.slice(0, MAX_STRING)}… [+${value.length - MAX_STRING} more characters]`;
  }

  if (typeof value !== "object") return value;

  if (depth >= MAX_DEPTH) return "[nested further — ask for this value on its own]";

  if (Array.isArray(value)) {
    if (value.length === 0) return [];

    const rows = value.filter(isPlainObject);
    const isTable = rows.length === value.length;

    if (isTable && value.length > SAMPLE_ROWS) {
      const columns = columnsOf(rows);
      return {
        summary: `${value.length} rows × ${columns.length} columns`,
        columns,
        first: rows.slice(0, SAMPLE_ROWS).map((row) => abridge(row, depth + 1)),
      };
    }

    if (value.length > SAMPLE_ITEMS) {
      return {
        summary: `${value.length} items`,
        first: value.slice(0, SAMPLE_ITEMS).map((item) => abridge(item, depth + 1)),
      };
    }

    return value.map((item) => abridge(item, depth + 1));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_KEYS) {
    return {
      summary: `${entries.length} keys`,
      first: Object.fromEntries(
        entries.slice(0, MAX_KEYS).map(([key, item]) => [key, abridge(item, depth + 1)])
      ),
    };
  }

  return Object.fromEntries(entries.map(([key, item]) => [key, abridge(item, depth + 1)]));
}

/** True when abridging actually changed something, so the reply can say so once. */
export function wasAbridged(original: unknown, shortened: unknown): boolean {
  return JSON.stringify(original) !== JSON.stringify(shortened);
}

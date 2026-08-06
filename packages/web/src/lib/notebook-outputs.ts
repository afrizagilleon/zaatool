import type { NotebookOutput, NotebookOutputRender } from '@zaa-tool/shared';
import { OUTPUT_RENDERS } from '@zaa-tool/shared';

/**
 * Deciding how to show a value.
 *
 * The declaration is an override, not a requirement. A notebook written by an agent that
 * never thought about presentation still gets a usable page, because the value's own
 * shape is enough to choose: an array of objects is a table whether or not anyone said
 * so. Declaring `render` only matters where the guess would be wrong — most often a
 * table you would rather see as a chart.
 *
 * Nothing here configures a renderer. Columns come from the data, chart series come from
 * the columns, and paging and search are always on. That is what keeps this a single
 * declaration instead of the second one the old dashboard builder needed.
 */

export type ResolvedRender = Exclude<NotebookOutputRender, 'auto'>;

/**
 * The same list the engine validates against, not a copy of it.
 *
 * It was a copy for four milestones, and copies of a list are how `file` came to exist
 * everywhere except the one place a person could choose it.
 */
export const RENDERS: readonly NotebookOutputRender[] = OUTPUT_RENDERS;

/** Both written forms as one, so the editor never branches on how an output was typed. */
export function specsOf(outputs: Array<string | NotebookOutput>): NotebookOutput[] {
  return outputs.map((output) => (typeof output === 'string' ? { name: output } : { ...output }));
}

/**
 * Back to the shorter form where nothing was said.
 *
 * Keeps `outputs: [sum, workings]` looking like that in the document. Saving should not
 * quietly rewrite a notebook to record a decision its author never made.
 */
export function toDeclaration(spec: NotebookOutput): string | NotebookOutput {
  const bare = !spec.render || spec.render === 'auto';
  if (bare && !spec.description && !spec.x) return spec.name;

  const declaration: NotebookOutput = { name: spec.name };
  if (!bare) declaration.render = spec.render;
  if (spec.description) declaration.description = spec.description;
  if (spec.x) declaration.x = spec.x;
  return declaration;
}

/**
 * Rows of the same shape — the one structure worth its own renderer.
 *
 * An empty array counts. A query that matched nothing is still a table, and showing it
 * as `[]` tells the reader about JavaScript rather than about their data.
 */
export function asRows(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];

  const rows = value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item)
  );
  return rows.length === value.length ? rows : null;
}

/** A stored file, as an input of type `file` hands one to a notebook. */
function isFileLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && typeof record.path === 'string';
}

function looksLikeImage(value: string): boolean {
  return /^data:image\//i.test(value) || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(value);
}

export function inferRender(value: unknown): ResolvedRender {
  if (typeof value === 'string') {
    if (looksLikeImage(value)) return 'image';
    // Long or multi-line prose is almost always meant to be read, and a notebook's own
    // output is as likely to be markdown as not — headings and lists cost nothing here.
    if (value.includes('\n') || value.length > 200) return 'markdown';
    return 'text';
  }

  if (asRows(value)) return 'table';
  // A file the engine stored already knows what it is. Writing `chart.png` should put a
  // picture on the page rather than a link that says "chart.png" — the mime type is right
  // there, and asking the author for `render: image` would be asking them to repeat it.
  if (isFileLike(value)) {
    const mime = String((value as Record<string, unknown>).mime ?? '');
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'file';
  }
  if (value !== null && typeof value === 'object') return 'json';
  return 'text';
}

/** What was declared, or what the value looks like. */
export function renderFor(output: NotebookOutput, value: unknown): ResolvedRender {
  const declared = output.render;
  return !declared || declared === 'auto' ? inferRender(value) : declared;
}

/** Column names in first-seen order, so a table follows the shape the notebook built. */
export function columnsOf(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

import { asRows, columnsOf } from './notebook-outputs';

/**
 * A table, and any other output value, as text somebody can paste elsewhere.
 *
 * Lives in `lib` rather than beside the table component because two different buttons
 * need it — Download CSV on a table tile, and Copy on every tile — and because a pure
 * function exported from a component file is a function Vite's fast refresh has to give
 * up on for the whole file.
 */

/**
 * RFC 4180: a field containing a comma, a quote or a line break is quoted, and quotes
 * inside it are doubled. Getting this wrong is not a formatting nicety — a single
 * unescaped comma silently shifts every column after it by one.
 */
export function escapeCsvCell(value: unknown): string {
  const str =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** CRLF between records, which is what RFC 4180 says and what Excel expects. */
export function exportToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const headerLine = columns.map(escapeCsvCell).join(',');
  const rowLines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(','));
  return [headerLine, ...rowLines].join('\r\n');
}

/**
 * What lands on the clipboard when somebody copies a tile.
 *
 * A table copies as CSV so it can be pasted into a spreadsheet; a string copies as
 * itself, because wrapping it in JSON quotes would make the commonest case the most
 * annoying one; anything else copies as indented JSON.
 */
export function formatCopyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  const rows = asRows(value);
  if (rows && rows.length > 0) {
    return exportToCsv(columnsOf(rows), rows);
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

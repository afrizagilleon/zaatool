import { useMemo, useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';


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

export function exportToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const headerLine = columns.map(escapeCsvCell).join(',');
  const rowLines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(','));
  return [headerLine, ...rowLines].join('\r\n');
}

function triggerCsvDownload(csvContent: string, filename = 'table-data.csv') {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

import { CaretUp, CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { columnsOf } from '../../../lib/notebook-outputs';
import { cn } from '../../../lib/utils';

/**
 * Rows, with searching, sorting and paging that were never declared.
 *
 * None of the three is configurable, because none of them has ever been unwanted —
 * nobody produces five hundred rows and hopes they cannot be searched. A question
 * whose answer is always yes does not deserve to be asked, and every question removed
 * is one more thing that can no longer fall out of date. That is the whole difference
 * from the `tableConfig` this replaces.
 *
 * Columns come from the data in first-seen order, so the table follows the shape the
 * notebook actually built rather than a list someone has to maintain alongside it.
 */

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * The point past which the page stops pretending.
 *
 * A notebook returning a million rows is already broken well before this renderer sees
 * them: scope crosses cell boundaries as JSON, the whole value is copied into the run
 * record, and all of it is sent over HTTP. Paging here would only hide that. So the rows
 * that arrived are shown, the true count is stated, and the fix is named — narrow it in
 * the notebook, which has a database and can say LIMIT.
 */
const MAX_ROWS = 5_000;

/** What a cell shows. Objects are collapsed rather than expanded — a table is a grid. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * A cell that is a web address becomes a link.
 *
 * This is `auto` applied one level down: a URL is a *destination*, and the notebook has
 * already computed it per row. Showing it as unclickable text is the same failure as
 * printing `[{...}]` instead of a table.
 *
 * It is a link and never a button, and that line matters. A link is data the row already
 * carries; a button is a side effect with arguments, and the moment a row can trigger one
 * the table stops being a view and starts being a form — which is the road back to the
 * dashboard builder.
 *
 * The column name is the label. `verify: 'https://…'` renders under a VERIFY header, so
 * there is nothing to declare and no second shape to support.
 */
const LINKABLE = /^(https?:\/\/|mailto:)/i;

function linkOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Everything else — `javascript:`, `data:`, a bare `//host` — is left as text. A cell
  // comes from a notebook, and a notebook can be written by an agent.
  return LINKABLE.test(trimmed) ? trimmed : null;
}

/** Enough of a URL to recognise, short enough not to own the table's width. */
function linkText(url: string): string {
  if (url.toLowerCase().startsWith('mailto:')) return url.slice(7);
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host}${tail}`;
  } catch {
    return url;
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;

  const left = cellText(a);
  const right = cellText(b);

  // Numeric strings sort as numbers: "10" belongs after "9", not before it.
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left !== '' && right !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

export function TableView({ rows: given }: { rows: Record<string, unknown>[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: string; ascending: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const truncated = given.length > MAX_ROWS;
  const rows = useMemo(() => (truncated ? given.slice(0, MAX_ROWS) : given), [given, truncated]);
  const columns = useMemo(() => columnsOf(rows), [rows]);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      columns.some((column) => cellText(row[column]).toLowerCase().includes(needle))
    );
  }, [rows, columns, query]);

  const ordered = useMemo(() => {
    if (!sort) return found;
    const sorted = [...found].sort((a, b) => compare(a[sort.column], b[sort.column]));
    return sort.ascending ? sorted : sorted.reverse();
  }, [found, sort]);

  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = ordered.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (column: string) =>
    setSort((previous) =>
      previous?.column === column
        ? { column, ascending: !previous.ascending }
        : { column, ascending: true }
    );

  // Nothing to search, sort or page through — and an empty grid with no headers reads
  // as a broken component rather than as an empty result.
  if (rows.length === 0) {
    return (
      <p className="border border-border p-3 text-xs italic text-muted-foreground">No rows.</p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.length > PAGE_SIZES[0] && (
        <div className="relative">
          <MagnifyingGlass
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={`Search ${rows.length} rows`}
            className="h-7 pl-7 text-xs"
          />
        </div>
      )}

      <div className="overflow-x-auto border border-border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((column) => (
                <th key={column} className="p-0 text-left">
                  <button
                    type="button"
                    onClick={() => toggleSort(column)}
                    className="flex w-full items-center gap-1 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[10px] text-muted-foreground hover:text-foreground"
                    title={`Sort by ${column}`}
                  >
                    {column}
                    {sort?.column === column &&
                      (sort.ascending ? <CaretUp size={9} /> : <CaretDown size={9} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={index}
                className={cn('border-b border-border/60 last:border-0', index % 2 && 'bg-muted/20')}
              >
                {columns.map((column) => {
                  const url = linkOf(row[column]);
                  return (
                    <td
                      key={column}
                      className="max-w-64 truncate px-2 py-1.5 align-top font-mono tabular-nums"
                      title={cellText(row[column])}
                    >
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {linkText(url)}
                        </a>
                      ) : (
                        cellText(row[column])
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ordered.length === 0 && (
        <p className="py-3 text-center text-xs text-muted-foreground">Nothing matches “{query}”.</p>
      )}

      {/* Always, not only when it pages: how many rows there are is part of reading the
          answer, and it is the fact a caller most often wants back. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {ordered.length === 0
            ? 'No rows'
            : pageCount > 1
              ? `${current * pageSize + 1}–${Math.min((current + 1) * pageSize, ordered.length)} of ${ordered.length}`
              : `${ordered.length} ${ordered.length === 1 ? 'row' : 'rows'}`}
          {query && ordered.length !== rows.length && ` (filtered from ${rows.length})`}
        </span>

        <div className="flex items-center gap-1">
          {ordered.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              title="Download CSV"
              onClick={() => {
                const csv = exportToCsv(columns, ordered);
                triggerCsvDownload(csv);
              }}
            >
              <DownloadSimple size={10} />
              CSV
            </Button>
          )}

          {rows.length > PAGE_SIZES[0] && (

            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
              className="h-6 border border-border bg-card px-1 text-[10px] text-muted-foreground"
              title="Rows per page"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          )}
          {pageCount > 1 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </>
          )}
        </div>
      </div>

      {truncated && (
        <p className="border border-amber-500/40 bg-amber-500/5 p-2 text-[10px] leading-normal text-amber-600 dark:text-amber-400">
          Showing the first {MAX_ROWS.toLocaleString()} of {given.length.toLocaleString()} rows.
          Everything past that never left the notebook usefully — it was copied through
          scope, into the run record and over the wire. Narrow it there instead.
        </p>
      )}
    </div>
  );
}

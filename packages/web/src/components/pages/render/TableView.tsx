import { useMemo, useState } from 'react';
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

const PAGE_SIZE = 25;

/** What a cell shows. Objects are collapsed rather than expanded — a table is a grid. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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

export function TableView({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = useMemo(() => columnsOf(rows), [rows]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: string; ascending: boolean } | null>(null);
  const [page, setPage] = useState(0);

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

  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = ordered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (column: string) =>
    setSort((previous) =>
      previous?.column === column
        ? { column, ascending: !previous.ascending }
        : { column, ascending: true }
    );

  return (
    <div className="space-y-2">
      {rows.length > PAGE_SIZE && (
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
                {columns.map((column) => (
                  <td
                    key={column}
                    className="px-2 py-1.5 align-top font-mono tabular-nums"
                    title={cellText(row[column])}
                  >
                    {cellText(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ordered.length === 0 && (
        <p className="py-3 text-center text-xs text-muted-foreground">Nothing matches “{query}”.</p>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, ordered.length)} of{' '}
            {ordered.length}
          </span>
          <div className="flex items-center gap-1">
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
          </div>
        </div>
      )}
    </div>
  );
}

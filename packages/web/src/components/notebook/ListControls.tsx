import { MagnifyingGlass, X, FunnelSimple, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../../lib/utils';
import type { NotebookGrouping, NotebookSort } from '../../lib/notebook-list-view';

/**
 * The row of controls above a list, and the pager below it.
 *
 * One component for both screens because Notebooks and Apps are the same problem seen
 * twice, and two hand-built control rows would have drifted within a week. What each
 * screen can answer differs — a page is deployed by definition, so Apps has no deploy
 * filter — so every optional control appears only when its handler is given.
 *
 * Wraps rather than scrolls. The row this replaces measured 435px inside a 375px screen
 * and put its last control somewhere unreachable.
 */

export interface ListControlsProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Placeholder carries the total, so the count is visible before you type. */
  total: number;
  sort: NotebookSort;
  onSortChange: (sort: NotebookSort) => void;
  /** Omit to hide the grouping control on a screen that has nothing to group by. */
  grouping?: NotebookGrouping;
  onGroupingChange?: (grouping: NotebookGrouping) => void;
  deployedOnly?: boolean;
  onDeployedOnlyChange?: (only: boolean) => void;
  tag: string | null;
  onTagChange: (tag: string | null) => void;
  tags: { tag: string; count: number }[];
  showFixtures: boolean;
  onShowFixturesChange: (show: boolean) => void;
  hiddenFixtures: number;
  isFiltered: boolean;
  onClear: () => void;
}

const SORT_LABELS: Record<NotebookSort, string> = {
  updated: 'Last edited',
  created: 'Newest',
  name: 'Name',
  run: 'Last run',
};

export function ListControls({
  query,
  onQueryChange,
  total,
  sort,
  onSortChange,
  grouping,
  onGroupingChange,
  deployedOnly,
  onDeployedOnlyChange,
  tag,
  onTagChange,
  tags,
  showFixtures,
  onShowFixturesChange,
  hiddenFixtures,
  isFiltered,
  onClear,
}: ListControlsProps) {
  return (
    <div className="mb-3 space-y-2">
      <div className="relative">
        <MagnifyingGlass
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={`Search ${total} by name or tag`}
          aria-label="Search"
          className="h-8 pl-8 text-xs"
        />
        {query !== '' && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onQueryChange('')}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* `min-w-0` on every select: a flex child will not shrink below its content
          without it, which is how a control row ends up wider than the screen. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={sort} onValueChange={(value) => onSortChange(value as NotebookSort)}>
          <SelectTrigger size="sm" aria-label="Sort" className="h-7 min-w-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as NotebookSort[]).map((key) => (
              <SelectItem key={key} value={key} className="text-xs">
                {SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {grouping !== undefined && onGroupingChange && (
          <Select
            value={grouping}
            onValueChange={(value) => onGroupingChange(value as NotebookGrouping)}
          >
            <SelectTrigger size="sm" aria-label="Group" className="h-7 min-w-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">
                No grouping
              </SelectItem>
              <SelectItem value="trigger" className="text-xs">
                By trigger
              </SelectItem>
              <SelectItem value="tag" className="text-xs">
                By tag
              </SelectItem>
            </SelectContent>
          </Select>
        )}

        {tags.length > 0 && (
          <Select
            value={tag ?? '~any'}
            onValueChange={(value) => onTagChange(value === '~any' ? null : value)}
          >
            <SelectTrigger size="sm" aria-label="Tag" className="h-7 min-w-0 max-w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="~any" className="text-xs">
                Any tag
              </SelectItem>
              {tags.map(({ tag: name, count }) => (
                <SelectItem key={name} value={name} className="text-xs">
                  {name} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {onDeployedOnlyChange && (
          <Button
            size="sm"
            variant={deployedOnly ? 'secondary' : 'ghost'}
            aria-pressed={deployedOnly}
            className={cn('h-7 shrink-0 px-2.5 text-xs', !deployedOnly && 'text-muted-foreground')}
            onClick={() => onDeployedOnlyChange(!deployedOnly)}
          >
            <FunnelSimple size={12} className="mr-1.5" />
            Deployed
          </Button>
        )}

        {/* Hidden, never deleted — and never silently. The count is the whole point:
            a list quietly holding fifteen things back is a list you cannot trust. */}
        {(hiddenFixtures > 0 || showFixtures) && (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={showFixtures}
            className="h-7 shrink-0 px-2.5 text-xs text-muted-foreground"
            onClick={() => onShowFixturesChange(!showFixtures)}
          >
            {showFixtures ? 'Hide test fixtures' : `Show ${hiddenFixtures} test fixtures`}
          </Button>
        )}

        {isFiltered && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2.5 text-xs text-muted-foreground"
            onClick={onClear}
          >
            <X size={12} className="mr-1.5" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Page n of m, and nothing at all when there is only one page.
 *
 * A pager on a five-item list is furniture. `aria-live` because pressing Next moves
 * content that a screen reader has no other way to notice.
 */
export function Pager({
  page,
  pageCount,
  total,
  shown,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  shown: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) {
    return (
      <p className="mt-3 text-center text-[10px] text-muted-foreground/60" aria-live="polite">
        {total === 0 ? '' : `${total} ${total === 1 ? 'notebook' : 'notebooks'}`}
      </p>
    );
  }

  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        disabled={page <= 1}
        aria-label="Previous page"
        onClick={() => onPageChange(page - 1)}
      >
        <CaretLeft size={12} />
      </Button>
      <span className="text-[10px] text-muted-foreground" aria-live="polite">
        {page} / {pageCount} · showing {shown} of {total}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        disabled={page >= pageCount}
        aria-label="Next page"
        onClick={() => onPageChange(page + 1)}
      >
        <CaretRight size={12} />
      </Button>
    </div>
  );
}

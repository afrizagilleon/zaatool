import { isFixtureName, type NotebookSummary } from '@zaa-tool/shared';

/**
 * Turning a list of notebooks into the part of it you are looking for.
 *
 * Twenty-nine notebooks in one unsorted, unfiltered, unpaged column is not a list — it is
 * a scroll, and finding anything in it means reading all of it. Worse, fifteen of the
 * twenty-nine are my own test fixtures, so most of what you scroll past is scaffolding I
 * left in your workspace.
 *
 * All of it is here rather than in the component, and none of it touches React: deciding
 * *which* notebooks to show is a question with right answers, and a question with right
 * answers should be answerable without rendering anything. The two screens that need it —
 * Notebooks and Apps — then share one set of rules instead of growing two that drift.
 *
 * Done in the browser rather than in SQL because the whole list is one small request and
 * already arrives complete; a filter that costs a round trip is a filter nobody uses
 * mid-typing. That trade holds for hundreds of notebooks, not for tens of thousands —
 * at that point this becomes query parameters, and the shape of these functions is
 * already the shape of those parameters.
 */

export const PAGE_SIZE = 20;

export type NotebookSort = 'updated' | 'created' | 'name' | 'run';

export type NotebookGrouping = 'none' | 'trigger' | 'tag';

export interface NotebookFilters {
  /** Matched against name and tags. Empty means everything. */
  query: string;
  /** Fixtures are hidden until asked for. They are never deleted for you. */
  showFixtures: boolean;
  /** Only notebooks with a pinned version — the ones that can actually be reached. */
  deployedOnly: boolean;
  /** A single tag, or null for any. */
  tag: string | null;
  sort: NotebookSort;
  grouping: NotebookGrouping;
}

export const DEFAULT_FILTERS: NotebookFilters = {
  query: '',
  showFixtures: false,
  deployedOnly: false,
  tag: null,
  sort: 'updated',
  grouping: 'none',
};

/** True when any filter is doing something, which is what makes "Clear" worth offering. */
export function isFiltered(filters: NotebookFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.showFixtures ||
    filters.deployedOnly ||
    filters.tag !== null
  );
}

/**
 * The least a thing must have to be searched for by name.
 *
 * Structural rather than `NotebookSummary`, because Apps searches deployed pages and
 * Notebooks searches drafts, and the rule for *"does this match what I typed"* should
 * not be written twice and then diverge on the day one of them learns about tags.
 */
export interface SearchableItem {
  name: string;
  tags: string[];
  runtime?: string;
  description?: string;
}

/**
 * Whether one item answers a search.
 *
 * Name, tags, runtime and description — searching only names meant a tag was a label you
 * could read but not use, and a page's own first sentence was invisible to the box
 * sitting above it. Every term has to match something, so `daily py` narrows rather than
 * widens: two words that each match half the list are otherwise a worse search than one.
 */
export function matchesQuery(item: SearchableItem, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = [item.name, item.runtime ?? '', item.description ?? '', ...item.tags]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function filterNotebooks(
  notebooks: readonly NotebookSummary[],
  filters: NotebookFilters
): NotebookSummary[] {
  return notebooks.filter((notebook) => {
    if (!filters.showFixtures && isFixtureName(notebook.name)) return false;
    if (filters.deployedOnly && !notebook.deployed) return false;
    if (filters.tag !== null && !notebook.tags.includes(filters.tag)) return false;
    return matchesQuery(notebook, filters.query);
  });
}

/** Milliseconds, or `-Infinity` for never — so "never ran" sorts last under `desc`. */
function time(value: string | null): number {
  if (!value) return -Infinity;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? -Infinity : ms;
}

export function sortNotebooks(
  notebooks: readonly NotebookSummary[],
  sort: NotebookSort
): NotebookSummary[] {
  const sorted = [...notebooks];
  switch (sort) {
    case 'name':
      // `localeCompare` with `numeric`, so `report-2` comes before `report-10`.
      return sorted.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );
    case 'created':
      return sorted.sort((a, b) => time(b.created_at) - time(a.created_at));
    case 'run':
      return sorted.sort((a, b) => time(b.last_run_at) - time(a.last_run_at));
    case 'updated':
    default:
      return sorted.sort((a, b) => time(b.updated_at) - time(a.updated_at));
  }
}

export interface NotebookPageSlice {
  items: NotebookSummary[];
  /** 1-based, clamped into range — a filter that shrinks the list cannot strand you. */
  page: number;
  pageCount: number;
  total: number;
}

export function paginate(
  notebooks: readonly NotebookSummary[],
  page: number,
  size = PAGE_SIZE
): NotebookPageSlice {
  const pageCount = Math.max(1, Math.ceil(notebooks.length / size));
  // Clamped rather than trusted: filtering while on page 3 of 4 would otherwise leave
  // you looking at an empty screen with no clue that anything matched.
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * size;

  return {
    items: notebooks.slice(start, start + size),
    page: current,
    pageCount,
    total: notebooks.length,
  };
}

export interface NotebookGroup {
  key: string;
  label: string;
  items: NotebookSummary[];
}

/**
 * How a notebook is started, which is the division that already exists in the system.
 *
 * The map groups by entry point for agents; people got a flat list. These are the same
 * three answers: something starts it on a clock, something calls it over HTTP, or you do.
 */
function triggerGroupOf(notebook: NotebookSummary): { key: string; label: string } {
  if (notebook.trigger_kinds.includes('cron')) return { key: 'cron', label: 'On a schedule' };
  if (notebook.trigger_kinds.includes('webhook')) return { key: 'webhook', label: 'Called by webhook' };
  return { key: 'manual', label: 'Started by hand' };
}

/**
 * Splits an already-paged slice into headed sections.
 *
 * Grouping is applied *after* paging on purpose: a page is a fixed amount of screen, and
 * grouping first would make one page mean twenty rows and the next mean two hundred.
 * So the sections describe what is in front of you, and the page count still means pages.
 */
export function groupNotebooks(
  notebooks: readonly NotebookSummary[],
  grouping: NotebookGrouping
): NotebookGroup[] {
  if (grouping === 'none') return [{ key: 'all', label: '', items: [...notebooks] }];

  const groups = new Map<string, NotebookGroup>();
  const push = (key: string, label: string, notebook: NotebookSummary) => {
    const existing = groups.get(key);
    if (existing) existing.items.push(notebook);
    else groups.set(key, { key, label, items: [notebook] });
  };

  for (const notebook of notebooks) {
    if (grouping === 'trigger') {
      const { key, label } = triggerGroupOf(notebook);
      push(key, label, notebook);
      continue;
    }
    // By tag, a notebook with three tags appears in three sections. That is the point of
    // tags rather than folders — it does not have to choose.
    if (notebook.tags.length === 0) push('~untagged', 'No tags', notebook);
    else for (const tag of notebook.tags) push(tag, tag, notebook);
  }

  return [...groups.values()].sort((a, b) => {
    // Whatever has no answer goes last, whichever grouping asked the question.
    const rank = (key: string) => (key === 'manual' || key === '~untagged' ? 1 : 0);
    if (rank(a.key) !== rank(b.key)) return rank(a.key) - rank(b.key);
    return a.label.localeCompare(b.label);
  });
}

/** Every tag in use, most-used first, for building a filter nobody has to type into. */
export function tagCounts(
  notebooks: readonly { tags: string[] }[]
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const notebook of notebooks) {
    for (const tag of notebook.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** How many rows the fixture filter is holding back, so hiding is never silent. */
export function hiddenFixtureCount(
  items: readonly { name: string }[],
  showFixtures: boolean
): number {
  if (showFixtures) return 0;
  return items.filter((item) => isFixtureName(item.name)).length;
}

/** Short, absolute, and never "3 minutes ago" for something three weeks old. */
export function whenLabel(value: string | null): string {
  if (!value) return 'never';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'never';

  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString();
}

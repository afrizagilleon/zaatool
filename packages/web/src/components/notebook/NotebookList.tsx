import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Notebook as NotebookIcon,
  ArrowSquareIn,
  TrashSimple,
  X,
  Broadcast,
  Clock,
  LinkSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import type { NotebookRuntime, NotebookSummary } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { ListControls, Pager } from './ListControls';
import { ListFreshness } from './ListFreshness';
import { useCatalogRefresh } from '../../hooks/useCatalogRefresh';
import {
  DEFAULT_FILTERS,
  filterNotebooks,
  groupNotebooks,
  hiddenFixtureCount,
  isFiltered as anyFilterActive,
  paginate,
  sortNotebooks,
  tagCounts,
  whenLabel,
  type NotebookFilters,
} from '../../lib/notebook-list-view';
import { readShowFixtures, writeShowFixtures } from '../../lib/list-preferences';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { notebooksApi } from '../../lib/notebooks-api';

interface NotebookListProps {
  onOpen: (id: string) => void;
  onCreate: (runtime: NotebookRuntime) => void;
}

/**
 * Every notebook, and the two things you can do to one from here.
 *
 * Deleting used to be a bin icon on each row, held at `opacity-0` until the row was
 * hovered. That is not a hidden control — **an invisible element is still a tappable
 * one** — and a phone has no hover, so the button was permanently invisible and
 * permanently live. It also called `notebooksApi.delete` immediately: no confirmation, no
 * undo, nothing to read afterwards. A notebook was deleted by a thumb landing near the
 * right-hand edge of a row.
 *
 * So deleting is now something you enter rather than something you can brush against:
 * press **Select**, tick what should go, confirm a dialog that names them. Two deliberate
 * acts and a sentence in between. The rest of the time there is no destructive control on
 * the screen at all.
 *
 * The row also says what it is now — deployed or not, when it last ran, whether that run
 * failed, what it is tagged. Those were all questions you could previously only answer by
 * opening the notebook, which for twenty-nine notebooks is twenty-nine answers you never
 * got. Which of them to *show* is decided in `notebook-list-view.ts`, away from any
 * rendering, so the rules can be tested for being right rather than for looking right.
 */
export function NotebookList({ onOpen, onCreate }: NotebookListProps) {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  // Default hides fixtures; a decision to show them outlives the reload that follows it.
  const [filters, setFilters] = useState<NotebookFilters>(() => ({
    ...DEFAULT_FILTERS,
    showFixtures: readShowFixtures('notebooks'),
  }));
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const change = (patch: Partial<NotebookFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    // Any change to what is shown starts again at the front. Staying on page 3 while the
    // result shrinks to one page is how a filter appears to have found nothing.
    setPage(1);
  };

  /** One writer, because three buttons setting the same flag is three chances to forget. */
  const setShowFixtures = (showFixtures: boolean) => {
    writeShowFixtures('notebooks', showFixtures);
    change({ showFixtures });
  };

  /** Null when not selecting. A set — empty — is how selecting starts. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * `quietly` is for the fetches nobody asked for. A notebook saved in another tab must
   * not throw this list into its loading state — the rows are still on screen, they are
   * merely about to be a little more correct, and blanking them would be a worse lie than
   * being briefly stale.
   */
  const refresh = async ({ quietly = false } = {}) => {
    if (!quietly) setIsLoading(true);
    try {
      setNotebooks(await notebooksApi.list());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (!quietly) setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Deploy in the editor, and this list knows. Before it, every screen was a photograph
  // of the moment it opened and the only way to find out was to press reload.
  const live = useCatalogRefresh(() => void refresh({ quietly: true }));

  const removeSelected = async () => {
    if (!selected || selected.size === 0) return;
    setIsDeleting(true);
    try {
      // Sequential rather than parallel: if the fourth one is refused, the first three
      // are already gone and the list has to show what actually happened.
      for (const id of selected) await notebooksApi.delete(id);
      setError(null);
      setSelected(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDeleting(false);
      setConfirming(false);
      await refresh();
    }
  };

  /**
   * Imports a notebook from the text form.
   *
   * Always as a new notebook. The file carries the id it had wherever it came from, and
   * a colleague's export landing on top of whatever holds that id here would be a very
   * quiet way to lose work.
   */
  const importFile = async (file: File) => {
    try {
      const saved = await notebooksApi.saveText(await file.text(), true);
      await refresh();
      onOpen(saved.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Filter, then sort, then page, then group — in that order, and grouping last on
  // purpose: a page is a fixed amount of screen, and grouping before paging would make
  // one page mean twenty rows and the next mean two hundred.
  const view = useMemo(() => {
    const matched = sortNotebooks(filterNotebooks(notebooks, filters), filters.sort);
    const slice = paginate(matched, page);
    return { slice, groups: groupNotebooks(slice.items, filters.grouping) };
  }, [notebooks, filters, page]);

  const tags = useMemo(() => tagCounts(notebooks), [notebooks]);
  const hiddenFixtures = hiddenFixtureCount(notebooks, filters.showFixtures);

  const selecting = selected !== null;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chosen = notebooks.filter((notebook) => selected?.has(notebook.id));

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Wraps rather than overflowing. At 375px these four controls measured 435px
            wide and the last of them could not be reached at all. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-bold uppercase tracking-widest text-foreground">Notebooks</h1>
          <div className="flex-1" />

          {selecting ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs"
                onClick={() => setSelected(null)}
              >
                <X size={12} className="mr-1.5" />
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-2.5 text-xs"
                disabled={(selected?.size ?? 0) === 0}
                onClick={() => setConfirming(true)}
              >
                <TrashSimple size={12} className="mr-1.5" />
                Delete {selected?.size ?? 0}
              </Button>
            </>
          ) : (
            <>
              {notebooks.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs text-muted-foreground"
                  onClick={() => setSelected(new Set())}
                >
                  Select
                </Button>
              )}

              {/* The text form is what agents already read and write, so importing one is
                  opening a file rather than a format anyone had to invent.

                  `ArrowSquareIn` rather than an up arrow: up and down mean opposite things
                  depending on whether you are thinking about the file or the app, which is
                  why these two read as swapped. In and out have no such axis. */}
              <label
                className="inline-flex h-7 cursor-pointer items-center gap-1.5 border border-border px-2.5 text-xs hover:bg-muted"
                title="Open a notebook exported as .md"
              >
                <ArrowSquareIn size={12} />
                Import
                <input
                  type="file"
                  accept=".md,text/markdown"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void importFile(file);
                  }}
                />
              </label>
              <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => onCreate('node')}>
                <Plus size={12} className="mr-1.5" />
                JavaScript
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2.5 text-xs"
                onClick={() => onCreate('python')}
              >
                <Plus size={12} className="mr-1.5" />
                Python
              </Button>
            </>
          )}
        </div>

        {notebooks.length > 0 && (
          <ListControls
            query={filters.query}
            onQueryChange={(query) => change({ query })}
            // What the box would look at with the box empty — everything the other
            // filters still allow.
            searchable={filterNotebooks(notebooks, { ...filters, query: '' }).length}
            total={notebooks.length}
            sort={filters.sort}
            onSortChange={(sort) => change({ sort })}
            grouping={filters.grouping}
            onGroupingChange={(grouping) => change({ grouping })}
            deployedOnly={filters.deployedOnly}
            onDeployedOnlyChange={(deployedOnly) => change({ deployedOnly })}
            tag={filters.tag}
            onTagChange={(tag) => change({ tag })}
            tags={tags}
            showFixtures={filters.showFixtures}
            onShowFixturesChange={setShowFixtures}
            hiddenFixtures={hiddenFixtures}
            isFiltered={anyFilterActive(filters)}
            onClear={() => {
              // Clear resets the remembered answer too, or the next reload would
              // contradict the screen you are looking at.
              writeShowFixtures('notebooks', false);
              change(DEFAULT_FILTERS);
            }}
          />
        )}

        <ListFreshness live={live} onRefresh={() => void refresh()} />

        {error && (
          <div className="mb-3 px-3 py-2 text-xs text-status-error border border-status-error/40">{error}</div>
        )}

        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

        {/* Says what is hiding it. "Nothing matches" while a fixture filter silently
            holds fifteen rows back is a lie by omission. */}
        {!isLoading && notebooks.length > 0 && view.slice.total === 0 && (
          <div className="py-6 text-center">
            <p className="text-xs text-muted-foreground">Nothing matches those filters.</p>
            {hiddenFixtures > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 px-2.5 text-xs text-muted-foreground"
                onClick={() => setShowFixtures(true)}
              >
                {hiddenFixtures} test {hiddenFixtures === 1 ? 'fixture is' : 'fixtures are'} hidden
              </Button>
            )}
          </div>
        )}

        {!isLoading && notebooks.length === 0 && !error && (
          <div className="border border-dashed border-border p-8 text-center">
            <NotebookIcon size={22} className="mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              No notebooks yet. Create one to start writing steps.
            </p>
          </div>
        )}

        {view.groups.map((group) => (
          <section key={group.key} className="mb-3">
            {group.label && (
              <h2 className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {group.label} <span className="font-normal">({group.items.length})</span>
              </h2>
            )}
            <div className="space-y-1">
              {group.items.map((notebook) => (
                <div
                  key={notebook.id}
                  // 44px tall, which is the smallest target a thumb hits reliably.
                  className="flex min-h-11 items-center gap-3 border border-border px-3 py-2 hover:border-primary/50 cursor-pointer"
                  onClick={() => (selecting ? toggle(notebook.id) : onOpen(notebook.id))}
                >
                  {selecting ? (
                    <Checkbox
                      checked={selected?.has(notebook.id) ?? false}
                      // The row handles it. A second handler here would toggle twice.
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={() => toggle(notebook.id)}
                      className="shrink-0"
                    />
                  ) : (
                    <NotebookIcon size={14} className="shrink-0 text-muted-foreground" />
                  )}

                  {/* Name above, everything else below. On one line the name was the only
                      thing that could give way, so it was cut to `zz-uji-berka…` while a
                      timestamp nobody was reading kept its full width. */}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {notebook.name}
                      </span>
                      {/* Live, and therefore reachable by a webhook, a schedule, an agent
                          or a page. Previously the only way to know was to open it. */}
                      {notebook.deployed && (
                        <Broadcast
                          size={11}
                          weight="fill"
                          className="shrink-0 text-status-success"
                          aria-label="Deployed"
                        />
                      )}
                      {notebook.trigger_kinds.includes('cron') && (
                        <Clock size={11} className="shrink-0 text-muted-foreground/70" aria-label="On a schedule" />
                      )}
                      {notebook.trigger_kinds.includes('webhook') && (
                        <LinkSimple size={11} className="shrink-0 text-muted-foreground/70" aria-label="Called by webhook" />
                      )}
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground/60">
                      {/* Relative on the row, absolute in the tooltip: "3d ago" is what
                          you read at a glance, and the exact moment is what you need
                          about twice a month. */}
                      <span title={new Date(notebook.updated_at).toLocaleString()}>
                        edited {whenLabel(notebook.updated_at)}
                      </span>
                      {/* A notebook that has been failing since Tuesday looked exactly
                          like one that has never been run. */}
                      {notebook.last_run_at && (
                        <span
                          className={
                            notebook.last_run_status === 'failed'
                              ? 'flex items-center gap-1 text-status-error'
                              : ''
                          }
                        >
                          {notebook.last_run_status === 'failed' && (
                            <WarningCircle size={10} weight="fill" />
                          )}
                          ran {whenLabel(notebook.last_run_at)}
                        </span>
                      )}
                      {notebook.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          // Clicking a tag filters by it — the shortest path from
                          // "these are related" to "show me only those".
                          onClick={(event) => {
                            event.stopPropagation();
                            change({ tag });
                          }}
                          className="text-muted-foreground/80 hover:text-foreground"
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <span className="shrink-0 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {notebook.runtime === 'python' ? 'py' : 'js'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}

        {!isLoading && view.slice.total > 0 && (
          <Pager
            page={view.slice.page}
            pageCount={view.slice.pageCount}
            total={view.slice.total}
            shown={view.slice.items.length}
            onPageChange={setPage}
          />
        )}
      </div>

      {/* Names them. "Delete 3 notebooks?" is a number; the names are what tells you
          whether the third one is the thing you spent yesterday on. */}
      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {chosen.length} {chosen.length === 1 ? 'notebook' : 'notebooks'}?
            </DialogTitle>
            <DialogDescription>
              This cannot be undone. Runs and deployments belonging to them go too.
            </DialogDescription>
          </DialogHeader>

          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {chosen.map((notebook) => (
              <li key={notebook.id} className="truncate font-mono text-xs text-foreground">
                {notebook.name}
              </li>
            ))}
          </ul>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={isDeleting} onClick={removeSelected}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Spinner,
  AppWindow,
  ArrowLeft,
  ShareNetwork,
  WarningCircle,
  CircleDashed,
} from '@phosphor-icons/react';
import { isFixtureName, type NotebookPage } from '@zaa-tool/shared';
import { ListControls, Pager } from '../notebook/ListControls';
import { ListFreshness } from '../notebook/ListFreshness';
import { useCatalogRefresh } from '../../hooks/useCatalogRefresh';
import { readShowFixtures, writeShowFixtures } from '../../lib/list-preferences';
import {
  PAGE_SIZE,
  hiddenFixtureCount,
  matchesQuery,
  tagCounts,
  type NotebookSort,
} from '../../lib/notebook-list-view';
import { Button } from '../ui/button';
import { usePageRun, type OutputStatus } from '../../hooks/usePageRun';
import { notebooksApi } from '../../lib/notebooks-api';
import { NotesBlock } from './render/NotesBlock';
import { CopyTileValueButton } from './render/CopyTileValueButton';
import { tileTitle } from '../../lib/tile-title';

import { OutputView } from './render/OutputView';

import { PageGrid } from './render/PageGrid';
import { ShareDialog } from './ShareDialog';
import { InputField } from './render/InputField';
import { initialValues, toArgs } from '../../lib/app-inputs';

import { PageActions } from './render/PageActions';
import { cn } from '../../lib/utils';

const EMPTY_PAGES: NotebookPage[] = [];

/**
 * A page for every deployed notebook, built from its contract.
 *
 * There is no layout to design and no widgets to drag, because a notebook that declares
 * what it takes and what it returns has already described its own page. The dashboard
 * builder this replaces asked you to say all of it a second time, in a different place,
 * and then to keep the two in step.
 *
 * It runs the *deployed* version. Someone using a page is not editing a notebook, and
 * the draft is where the editing happens.
 */

/** What an output looks like before it exists, and when it never will. */
function Pending({ status }: { status: OutputStatus }) {
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-status-error">
        <WarningCircle size={13} weight="fill" />
        Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
      {status === 'running' ? (
        <>
          <Spinner size={13} className="animate-spin" />
          Working…
        </>
      ) : (
        <>
          <CircleDashed size={13} />
          Waiting
        </>
      )}
    </span>
  );
}

/**
 * What an open page does when the notebook behind it moves.
 *
 * Not swap. Someone is halfway through a form, and replacing the fields under their hands
 * — dropping one they had filled in, adding an empty required one — is the app deciding
 * that a deploy in another window matters more than what they are doing. Nor stay silent:
 * pressing Run would then send yesterday's arguments to today's contract and be refused
 * for reasons nothing on screen could explain.
 *
 * So it says so, and the choice is a button.
 */
function PageMoved({ gone, onReload }: { gone: boolean; onReload: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      <span>
        {gone
          ? 'This app has been taken out of production. What you see is the version you opened.'
          : 'A new version of this app has been deployed. You are looking at the one you opened.'}
      </span>
      {!gone && (
        <Button size="sm" variant="secondary" className="ml-auto h-6 px-2 text-[11px]" onClick={onReload}>
          Load it
        </Button>
      )}
    </div>
  );
}

export function PageRunner({

  page,
  latest,
  onReload,
  onBack,
}: {
  page: NotebookPage;
  /** The same app as the catalogue currently has it, or null once it is unpublished. */
  latest: NotebookPage | null;
  onReload: () => void;
  onBack: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(page.inputs));
  const moved = latest === null || JSON.stringify(latest) !== JSON.stringify(page);
  const { status, values: outputs, isRunning, error, start } = usePageRun(page.id, page.outputs);

  const hasResult = Object.keys(status).length > 0;
  const [isSharing, setIsSharing] = useState(false);
  const run = () => void start(toArgs(page.inputs, values));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="w-7 h-7 mt-0.5" onClick={onBack} title="Back">
            <ArrowLeft size={14} />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight">{page.name}</h1>
            {page.description && (
              <p className="text-sm text-muted-foreground mt-1">{page.description}</p>
            )}
          </div>
          {/* Sharing is about the page, not about this run, so it sits with the title
              rather than in the row of buttons that do things. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-3 text-xs text-muted-foreground"
            onClick={() => setIsSharing(true)}
          >
            <ShareNetwork size={14} className="mr-1.5" />
            Share
          </Button>
        </div>

        {moved && <PageMoved gone={latest === null} onReload={onReload} />}

        <NotesBlock notes={page.notes} />


        {page.inputs.length > 0 && (
          <div className="space-y-4 border border-border p-4">
            {page.inputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={values[input.name] ?? ''}
                onChange={(next) => setValues((current) => ({ ...current, [input.name]: next }))}
                notebookId={page.id}
              />
            ))}
          </div>
        )}

        {/* Stacked on a phone, side by side from `sm` up. Sharing one row at 320px left
            every declared button about 170px, which turns "Verify open.er-api.com" into
            "Verify open.er-…". Not `flex-wrap` on the wide layout: the buttons wrap inside
            their own block, so Run keeps its place when one of them reports back. */}
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
          <Button onClick={() => void run()} disabled={isRunning} className="h-9 px-5 sm:shrink-0">
            {isRunning ? (
              <Spinner size={15} className="animate-spin mr-2" />
            ) : (
              <Play size={15} weight="fill" className="mr-2" />
            )}
            Run
          </Button>
          <PageActions
            actions={page.actions}
            disabled={isRunning}
            onRerun={run}
            pageValues={values}
            notebookId={page.id}
            // This page's own values, then whatever the dialog asked for. The server keeps
            // only what the target declares, and anything the button fixed wins over both.
            onRun={(index, extra) =>
              notebooksApi.runAction(page.id, index, {
                ...toArgs(page.inputs, values),
                ...extra,
              })
            }
          />
        </div>

        <ShareDialog
          notebookId={page.id}
          notebookName={page.name}
          open={isSharing}
          onOpenChange={setIsSharing}
        />

        {error && (
          <div className="border border-status-error/40 bg-status-error/5 p-3 text-xs text-status-error">
            {error}
          </div>
        )}

        {!hasResult && !isRunning && page.outputs.length > 0 && (
          <div className="border border-border p-6 text-center">
            <p className="text-xs text-muted-foreground">
              This page has not been run yet. Click <span className="font-semibold text-foreground">Run</span> to execute it.
            </p>
          </div>
        )}

        {(hasResult || isRunning) && (
          <div className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Result
            </h2>
            {page.outputs.length === 0 && (
              <p className="text-xs text-muted-foreground">It declares no outputs.</p>
            )}

            <PageGrid
              outputs={page.outputs}
              layout={page.layout.length > 0 ? page.layout : undefined}
              renderTile={(output) => {
                const state = status[output.name] ?? 'waiting';
                // Whatever we have is shown; only a value from this run is shown at full
                // strength. Blanking on re-run makes the page jump, and showing a previous
                // run's number as if it were current is worse than either.
                const hasValue = output.name in outputs;
                const isCurrent = state === 'ready';

                return (
                  <>
                    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
                      <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {tileTitle(output)}
                      </span>
                      <div className="flex-1" />
                      {hasValue && <CopyTileValueButton value={outputs[output.name]} />}
                      {(state === 'running' || (state === 'stale' && isRunning)) && (

                        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/70">
                          <Spinner size={10} className="animate-spin" />
                          {state === 'running' ? 'Working' : 'From the last run'}
                        </span>
                      )}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-3">
                      {output.description && (
                        <p className="text-[11px] text-muted-foreground/70">{output.description}</p>
                      )}
                      {hasValue ? (
                        <div className={cn('min-h-0 flex-1', !isCurrent && 'opacity-40')}>
                          <OutputView output={output} value={outputs[output.name]} />
                        </div>
                      ) : (
                        <Pending status={state} />
                      )}
                    </div>
                  </>
                );
              }}
            />
          </div>
        )}

      </div>
    </div>
  );
}

/**
 * Every deployed page, findable.
 *
 * Twenty-four apps, fifteen of them my own test fixtures, and the first thirteen entries
 * all mine — a list where the thing you came for is below the fold behind scaffolding
 * somebody else left. So: fixtures hidden by default (hidden, never deleted), search over
 * name, description and tags, a sort, and pages of twenty.
 *
 * The rules come from `notebook-list-view.ts`, the same ones the Notebooks list uses. A
 * page is deployed by definition, so there is no deploy filter and nothing to group by a
 * trigger it does not describe.
 */
export function AppsPage() {
  const [pages, setPages] = useState<NotebookPage[] | null>(null);
  /**
   * The page as it was when it was opened, not a lookup into the list.
   *
   * A lookup was fine while the list never changed. Now that it refetches by itself, a
   * lookup would mean a deploy in another window silently rewriting the form somebody is
   * standing in front of.
   */
  const [open, setOpen] = useState<NotebookPage | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<NotebookSort>('name');
  const [tag, setTag] = useState<string | null>(null);
  // Default hides my fixtures; a decision to show them outlives the reload after it.
  const [showFixtures, setShowFixturesState] = useState(() => readShowFixtures('apps'));

  /** One writer, because three buttons setting the same flag is three chances to forget. */
  const setShowFixtures = (next: boolean) => {
    writeShowFixtures('apps', next);
    setShowFixturesState(next);
  };
  const [page, setPage] = useState(1);

  const reload = () =>
    notebooksApi
      .pages()
      .then(setPages)
      .catch(() => setPages([]));

  useEffect(() => {
    void reload();
  }, []);

  // The milestone's own test: deploy in one tab, and this changes in the other. Apps is
  // the screen where being stale is worst — a page that is not here yet reads as a deploy
  // that failed.
  const live = useCatalogRefresh(() => void reload());

  const all = pages ?? EMPTY_PAGES;
  const tags = useMemo(() => tagCounts(all), [all]);
  const hiddenFixtures = hiddenFixtureCount(all, showFixtures);

  const view = useMemo(() => {
    const matched = all.filter((item) => {
      if (!showFixtures && isFixtureName(item.name)) return false;
      if (tag !== null && !item.tags.includes(tag)) return false;
      return matchesQuery(item, query);
    });

    // Only the two orderings a page can answer. `pages` arrives newest-edited first, so
    // that order is what "Last edited" means here — there is no timestamp on a page to
    // sort by, and inventing one would be a sort that lies.
    const ordered =
      sort === 'name'
        ? [...matched].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          )
        : matched;

    const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, page), pageCount);
    return {
      items: ordered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
      page: current,
      pageCount,
      total: ordered.length,
    };
  }, [all, query, sort, tag, showFixtures, page]);

  const change = (apply: () => void) => {
    apply();
    setPage(1);
  };

  if (open) {
    const latest = pages?.find((item) => item.id === open.id) ?? null;
    return (
      <PageRunner
        // Keyed on the version, so taking the new one resets the form rather than leaving
        // half of yesterday's answers in today's fields.
        key={JSON.stringify(open)}
        page={open}
        latest={latest}
        onReload={() => latest && setOpen(latest)}
        onBack={() => setOpen(null)}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
          Apps
        </h1>

        {all.length > 0 && (
          <ListControls
            query={query}
            onQueryChange={(next) => change(() => setQuery(next))}
            searchable={
              all.filter(
                (item) =>
                  (showFixtures || !isFixtureName(item.name)) &&
                  (tag === null || item.tags.includes(tag))
              ).length
            }
            total={all.length}
            sort={sort}
            onSortChange={(next) => change(() => setSort(next))}
            tag={tag}
            onTagChange={(next) => change(() => setTag(next))}
            tags={tags}
            showFixtures={showFixtures}
            onShowFixturesChange={(next) => change(() => setShowFixtures(next))}
            hiddenFixtures={hiddenFixtures}
            isFiltered={query.trim() !== '' || tag !== null || showFixtures}
            onClear={() =>
              change(() => {
                setQuery('');
                setTag(null);
                setShowFixtures(false);
              })
            }
          />
        )}

        <ListFreshness live={live} onRefresh={() => void reload()} />

        {pages?.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-center py-16">
            <AppWindow size={28} weight="duotone" className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No pages yet.</p>
            <p className="text-xs text-muted-foreground/70 max-w-sm">
              Every deployed notebook that declares inputs or outputs appears here as a page.
              Nothing to lay out — the contract already says what to ask for and what to show.
            </p>
          </div>
        )}

        {all.length > 0 && view.total === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Nothing matches those filters.</p>
            {hiddenFixtures > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 px-2.5 text-xs text-muted-foreground"
                onClick={() => change(() => setShowFixtures(true))}
              >
                {hiddenFixtures} test {hiddenFixtures === 1 ? 'fixture is' : 'fixtures are'} hidden
              </Button>
            )}
          </div>
        )}

        <div className="space-y-2">
          {view.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpen(item)}
              className={cn(
                // No fixed height: a card with no description used to reserve the space
                // for one anyway, so a list of undescribed apps was mostly empty card.
                'w-full text-left border border-border px-4 py-2.5 bg-card',
                'hover:border-primary/50 transition-colors'
              )}
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-sm font-bold">{item.name}</span>
                {item.tags.map((name) => (
                  <span key={name} className="shrink-0 text-[10px] text-muted-foreground/70">
                    #{name}
                  </span>
                ))}
              </div>
              {item.description && (
                <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
              )}
              <div className="text-[10px] text-muted-foreground/60 mt-1 font-mono break-words">
                ({item.inputs.map((input) => input.name).join(', ') || 'no inputs'}) →{' '}
                {item.outputs.map((output) => output.name).join(', ') || 'nothing'}
              </div>
            </button>
          ))}
        </div>

        {view.total > 0 && (
          <Pager
            page={view.page}
            pageCount={view.pageCount}
            total={view.total}
            shown={view.items.length}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}

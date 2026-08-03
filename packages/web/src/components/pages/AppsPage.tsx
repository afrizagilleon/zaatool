import { useEffect, useState } from 'react';
import {
  Play,
  Spinner,
  AppWindow,
  ArrowLeft,
  ShareNetwork,
  WarningCircle,
  CircleDashed,
} from '@phosphor-icons/react';
import type { NotebookPage } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { usePageRun, type OutputStatus } from '../../hooks/usePageRun';
import { notebooksApi } from '../../lib/notebooks-api';
import { OutputView } from './render/OutputView';
import { PageGrid } from './render/PageGrid';
import { ShareDialog } from './ShareDialog';
import { InputField, initialValues, toArgs } from './render/InputField';
import { PageActions } from './render/PageActions';
import { cn } from '../../lib/utils';

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

function PageRunner({ page, onBack }: { page: NotebookPage; onBack: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(page.inputs));
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

        {page.inputs.length > 0 && (
          <div className="space-y-4 border border-border p-4">
            {page.inputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={values[input.name] ?? ''}
                onChange={(next) => setValues((current) => ({ ...current, [input.name]: next }))}
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
            onRun={(index) => notebooksApi.runAction(page.id, index, toArgs(page.inputs, values))}
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

        {hasResult && (
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
                        {output.name}
                      </span>
                      <div className="flex-1" />
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

export function AppsPage() {
  const [pages, setPages] = useState<NotebookPage[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    notebooksApi
      .pages()
      .then(setPages)
      .catch(() => setPages([]));
  }, []);

  const open = pages?.find((page) => page.id === openId);
  if (open) return <PageRunner page={open} onBack={() => setOpenId(null)} />;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
          Apps
        </h1>

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

        <div className="space-y-2">
          {(pages ?? []).map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => setOpenId(page.id)}
              className={cn(
                'w-full text-left border border-border px-4 py-3 bg-card',
                'hover:border-primary/50 transition-colors'
              )}
            >
              <div className="text-sm font-bold">{page.name}</div>
              {page.description && (
                <div className="text-xs text-muted-foreground mt-0.5">{page.description}</div>
              )}
              <div className="text-[10px] text-muted-foreground/60 mt-1.5 font-mono">
                ({page.inputs.map((input) => input.name).join(', ') || 'no inputs'}) →{' '}
                {page.outputs.map((output) => output.name).join(', ') || 'nothing'}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

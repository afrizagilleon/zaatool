import {
  Play,
  Spinner,
  WarningCircle,
  CircleDashed,
  RocketLaunch,
  DotsSixVertical,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import type { NotebookLayoutItem, NotebookOutput } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { useNotebookStore } from '../../store/notebookStore';
import { specsOf } from '../../lib/notebook-outputs';
import { OutputView } from '../pages/render/OutputView';
import { PageGrid, derivedLayout } from '../pages/render/PageGrid';
import { InputField } from '../pages/render/InputField';
import { cn } from '../../lib/utils';

/**
 * The page this notebook would serve, shown against the draft.
 *
 * Until this existed, seeing your page meant deploying it: you shipped to find out what
 * it looked like, then shipped again to fix it. That made deploying a way of looking
 * rather than a decision, which is the opposite of what the deploy gate is for.
 *
 * Nothing here fetches. The editor already holds every cell's last result, and which
 * names that cell wrote, so the preview is assembled from what is already on screen —
 * which also means it fills in live as the notebook runs, exactly as the real page does.
 *
 * Values come from the same test values the editor's Run uses. A second place to type
 * them would be a second place for them to disagree.
 */

interface PagePreviewProps {
  onRun: () => void;
  isRunning: boolean;
}

type PreviewStatus = 'waiting' | 'running' | 'ready' | 'failed';

/** Where each declared name currently stands, according to the cell that writes it. */
function resolve(
  outputs: NotebookOutput[],
  cellRuns: ReturnType<typeof useNotebookStore.getState>['cellRuns']
): Record<string, { status: PreviewStatus; value: unknown }> {
  const resolved: Record<string, { status: PreviewStatus; value: unknown }> = {};
  for (const output of outputs) resolved[output.name] = { status: 'waiting', value: undefined };

  // Later cells win, which is the same rule the scope itself follows.
  for (const run of Object.values(cellRuns)) {
    for (const name of run.written ?? []) {
      if (!(name in resolved)) continue;
      resolved[name] = {
        status: run.status === 'error' ? 'failed' : run.status === 'running' ? 'running' : 'ready',
        value: run.output?.[name],
      };
    }
  }

  // A cell that is running has not said what it will write yet; if it wrote a name last
  // time, that name is being recomputed now.
  for (const run of Object.values(cellRuns)) {
    if (run.status !== 'running') continue;
    for (const name of run.written ?? []) {
      if (name in resolved) resolved[name].status = 'running';
    }
  }

  return resolved;
}

function Pending({ status }: { status: PreviewStatus }) {
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
          Not run yet
        </>
      )}
    </span>
  );
}

export function PagePreview({ onRun, isRunning }: PagePreviewProps) {
  const name = useNotebookStore((s) => s.name);
  const inputs = useNotebookStore((s) => s.inputs);
  const declared = useNotebookStore((s) => s.outputs);
  const cellRuns = useNotebookStore((s) => s.cellRuns);
  const testArgs = useNotebookStore((s) => s.testArgs);
  const layout = useNotebookStore((s) => s.layout);
  const setLayout = useNotebookStore((s) => s.setLayout);
  const setTestArg = useNotebookStore((s) => s.setTestArg);

  const outputs = specsOf(declared);
  const resolved = resolve(outputs, cellRuns);

  /**
   * Only a real rearrangement counts.
   *
   * The grid reports its layout on mount and on every breakpoint change, so taking every
   * callback at face value marked the notebook unsaved merely for looking at its page.
   * A change that matches what is already stored — or that matches the derived layout
   * when nothing is stored — is not a change.
   */
  const rememberLayout = (next: NotebookLayoutItem[]) => {
    const current = layout.length > 0 ? layout : derivedLayout(outputs);
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    setLayout(next);
  };

  if (inputs.length === 0 && outputs.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-12 text-center">
          <RocketLaunch size={24} weight="duotone" className="mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">This notebook has no page yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground/70">
            A page is built from the contract. Declare an input or an output under
            Setup → Contract and it appears here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight">{name}</h1>
          <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
            Preview · draft
          </span>
        </div>

        {inputs.length > 0 && (
          <div className="space-y-4 border border-border p-4">
            {inputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={testArgs[input.name] ?? ''}
                onChange={(next) => setTestArg(input.name, next)}
              />
            ))}
            <p className="text-[10px] text-muted-foreground/60">
              These are the editor's test values — the same ones Run uses. Not saved with
              the notebook.
            </p>
          </div>
        )}

        <Button onClick={onRun} disabled={isRunning} className="h-9 px-5">
          {isRunning ? (
            <Spinner size={15} className="mr-2 animate-spin" />
          ) : (
            <Play size={15} weight="fill" className="mr-2" />
          )}
          Run
        </Button>

        {outputs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Result
              </h2>
              {layout.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-muted-foreground"
                  onClick={() => setLayout([])}
                  title="Go back to one tile per output, in declaration order"
                >
                  <ArrowCounterClockwise size={11} className="mr-1" />
                  Reset layout
                </Button>
              ) : (
                <span className="text-[10px] text-muted-foreground/60">
                  Drag a tile by its header · resize from either bottom corner
                </span>
              )}
            </div>

            <PageGrid
              outputs={outputs}
              layout={layout.length > 0 ? layout : undefined}
              onLayoutChange={rememberLayout}
              renderTile={(output) => {
                const state = resolved[output.name];
                const hasValue = state.value !== undefined;

                return (
                  <>
                    <div
                      className="tile-handle flex shrink-0 cursor-move items-center gap-1.5 border-b border-border/60 px-3 py-1.5"
                      title="Drag to move · drag either bottom corner to resize"
                    >
                      <DotsSixVertical size={14} weight="bold" className="text-muted-foreground/70" />
                      <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {output.name}
                      </span>
                      <div className="flex-1" />
                      {state.status === 'running' && (
                        <Spinner size={10} className="animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {/* Scrolls inside the tile: a tile too short shows less of its
                        content rather than cutting it off at the card's edge. */}
                    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-3">
                      {output.description && (
                        <p className="text-[11px] text-muted-foreground/70">{output.description}</p>
                      )}
                      {hasValue ? (
                        <div className={cn('min-h-0 flex-1', state.status !== 'ready' && 'opacity-40')}>
                          <OutputView output={output} value={state.value} />
                        </div>
                      ) : (
                        <Pending status={state.status} />
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

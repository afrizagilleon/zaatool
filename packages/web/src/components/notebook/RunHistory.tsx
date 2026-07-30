import { useCallback, useEffect, useState } from 'react';
import { ClockCounterClockwise, ArrowClockwise, Trash } from '@phosphor-icons/react';
import type { NotebookRunSummary } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { notebooksApi } from '../../lib/notebooks-api';

interface RunHistoryProps {
  notebookId: string;
  activeRunId: string | null;
  /** Refetch whenever this changes — a finished run should appear without a reload. */
  refreshKey: unknown;
  onOpenRun: (runId: string) => void;
}

function duration(run: NotebookRunSummary): string {
  if (!run.finished_at) return '…';
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-status-running',
  success: 'bg-status-done',
  failed: 'bg-status-error',
};

/**
 * Recent runs for this notebook.
 *
 * This is the answer to "the cron failed at 3am and I have no idea why": each run
 * keeps its status, error and per-cell output, so a failure can be opened and read
 * after the fact instead of being lost with the process.
 */
export function RunHistory({ notebookId, activeRunId, refreshKey, onOpenRun }: RunHistoryProps) {
  const [runs, setRuns] = useState<NotebookRunSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!notebookId) return;
    try {
      setRuns(await notebooksApi.listRuns(notebookId));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [notebookId]);

  const clear = useCallback(async () => {
    try {
      await notebooksApi.clearRuns(notebookId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [notebookId, refresh]);

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh, refreshKey]);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
        title="Run history"
        onClick={() => setIsOpen((open) => !open)}
      >
        <ClockCounterClockwise size={12} className="mr-1" />
        Runs
      </Button>

      {isOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close run history"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 w-80 max-h-80 overflow-auto bg-card border border-border shadow-lg z-50">
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border sticky top-0 bg-card">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                Run history
              </span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="w-5 h-5 text-muted-foreground"
                title="Refresh"
                onClick={() => void refresh()}
              >
                <ArrowClockwise size={11} />
              </Button>
              {runs.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-5 h-5 text-red-400 hover:text-red-300"
                  title="Clear all history for this notebook"
                  onClick={() => void clear()}
                >
                  <Trash size={11} />
                </Button>
              )}
            </div>

            {/* Retention is bounded automatically, so clearing is a convenience
                rather than something the notebook depends on. */}
            <p className="px-2 py-1 text-[9px] text-muted-foreground/50 border-b border-border/40">
              The 50 most recent runs are kept; older ones are dropped automatically.
            </p>

            {error && <p className="px-2 py-2 text-[10px] text-status-error">{error}</p>}

            {!error && runs.length === 0 && (
              <p className="px-2 py-3 text-[10px] text-muted-foreground">
                No runs recorded yet. Save and run this notebook.
              </p>
            )}

            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => {
                  onOpenRun(run.id);
                  setIsOpen(false);
                }}
                className={cn(
                  'flex items-center gap-2 w-full px-2 py-1.5 text-left border-b border-border/40 hover:bg-muted/50 transition-colors',
                  run.id === activeRunId && 'bg-primary/10'
                )}
              >
                <span
                  className={cn('w-1.5 h-1.5 shrink-0', STATUS_STYLES[run.status] ?? 'bg-muted')}
                  title={run.status}
                />
                <span className="text-[10px] text-foreground shrink-0">
                  {new Date(run.started_at).toLocaleString()}
                </span>
                <span className="text-[9px] text-muted-foreground/70 shrink-0">{duration(run)}</span>
                {run.cell_id && (
                  <span
                    className="text-[9px] px-1 bg-muted text-muted-foreground shrink-0"
                    title="Only one cell was run"
                  >
                    cell
                  </span>
                )}
                <span className="text-[9px] text-status-error truncate">{run.error ?? ''}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

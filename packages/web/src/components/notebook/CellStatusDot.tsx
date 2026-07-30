import { cn } from '../../lib/utils';
import type { CellRunState } from '../../store/notebookTypes';

interface CellStatusDotProps {
  run: CellRunState | undefined;
  isStale: boolean;
}

/**
 * The editor's honesty indicator. Green means this cell's visible output came from
 * the code shown next to it — so a clean production run would produce the same
 * thing. Amber means it would not, and grey means there is nothing to judge.
 */
export function CellStatusDot({ run, isStale }: CellStatusDotProps) {
  // Anything shown on screen counts as a result to judge, including a restored run
  // that recorded no source — otherwise output would sit under a "not run yet" dot.
  const hasResult =
    run !== undefined &&
    (run.ranSource !== undefined || run.status === 'error' || run.output !== undefined);

  const { className, title } =
    run?.status === 'running'
      ? { className: 'bg-status-running animate-pulse', title: 'Running' }
      : run?.status === 'error'
        ? { className: 'bg-status-error', title: 'Failed' }
        : !hasResult
          ? { className: 'bg-muted-foreground/30', title: 'Not run yet' }
          : isStale
            ? {
                className: 'bg-amber-500',
                title: 'Stale — this output cannot be trusted to match the code above it, re-run to confirm',
              }
            : { className: 'bg-status-done', title: 'Fresh — matches a clean run' };

  return <span className={cn('inline-block w-1.5 h-1.5 shrink-0', className)} title={title} />;
}

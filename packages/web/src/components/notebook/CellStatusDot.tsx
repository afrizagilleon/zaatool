import { cn } from '../../lib/utils';
import type { CellStatus } from '../../store/notebookTypes';

interface CellStatusDotProps {
  status: CellStatus;
  isStale: boolean;
  hasRun: boolean;
}

/**
 * The editor's honesty indicator. Green means this cell's visible output came
 * from the code shown next to it — so a clean production run would produce the
 * same thing. Amber means it would not.
 */
export function CellStatusDot({ status, isStale, hasRun }: CellStatusDotProps) {
  const { className, title } =
    status === 'running'
      ? { className: 'bg-status-running animate-pulse', title: 'Running' }
      : status === 'error'
        ? { className: 'bg-status-error', title: 'Failed' }
        : !hasRun
          ? { className: 'bg-muted-foreground/30', title: 'Not run yet' }
          : isStale
            ? { className: 'bg-amber-500', title: 'Stale — edited since it last ran, re-run to trust this output' }
            : { className: 'bg-status-done', title: 'Fresh — matches a clean run' };

  return <span className={cn('inline-block w-1.5 h-1.5 shrink-0', className)} title={title} />;
}

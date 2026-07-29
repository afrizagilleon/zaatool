import { cn } from '../../lib/utils';
import type { CellRunState } from '../../store/notebookTypes';

interface CellOutputProps {
  run: CellRunState | undefined;
  isStale: boolean;
}

function formatValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function CellOutput({ run, isStale }: CellOutputProps) {
  if (!run) return null;

  const hasLogs = run.logs.length > 0;
  const hasOutput = run.output !== undefined && Object.keys(run.output).length > 0;
  if (!hasLogs && !hasOutput && !run.error) return null;

  return (
    <div className={cn('border-t border-border/60 text-[11px]', isStale && 'opacity-50')}>
      {hasLogs && (
        <div className="px-3 py-2 font-mono space-y-0.5 border-b border-border/40">
          {run.logs.map((log, index) => (
            <div
              key={index}
              className={cn(
                'whitespace-pre-wrap break-words',
                log.level === 'error' ? 'text-status-error' : 'text-muted-foreground'
              )}
            >
              {log.msg}
            </div>
          ))}
        </div>
      )}

      {run.error && (
        <div className="px-3 py-2 font-mono text-status-error whitespace-pre-wrap break-words">
          {run.error}
        </div>
      )}

      {hasOutput && (
        <div className="px-3 py-2">
          {run.written && run.written.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {run.written.map((name) => (
                <span
                  key={name}
                  className="px-1.5 py-0.5 bg-primary/10 text-primary font-mono text-[10px]"
                  title="Published into the notebook scope"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
          <pre className="font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap break-words">
            {formatValue(run.output)}
          </pre>
        </div>
      )}

      {run.ms !== undefined && (
        <div className="px-3 pb-2 text-[10px] text-muted-foreground/60">{run.ms}ms</div>
      )}
    </div>
  );
}

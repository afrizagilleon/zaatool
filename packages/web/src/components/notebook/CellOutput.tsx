import { useState } from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import type { CellRunState } from '../../store/notebookTypes';

interface CellOutputProps {
  run: CellRunState | undefined;
  isStale: boolean;
}

/**
 * How much of a value the editor shows before it starts getting in the way.
 *
 * A cell returning ninety-three rows printed several hundred lines of JSON, and reaching
 * the next cell meant scrolling past all of them. The editor is where code is read; the
 * data itself belongs on the notebook's page. So a large value is described and folded,
 * and opening it is a decision rather than the default.
 */
const PREVIEW_LINES = 12;

function formatValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One line saying what a value is, so folding it away costs no information. */
function describe(value: unknown): string {
  if (Array.isArray(value)) {
    const rows = value.filter(
      (item) => typeof item === 'object' && item !== null && !Array.isArray(item)
    ) as Record<string, unknown>[];

    if (value.length > 0 && rows.length === value.length) {
      const columns = new Set<string>();
      for (const row of rows.slice(0, 20)) for (const key of Object.keys(row)) columns.add(key);
      return `${value.length} rows × ${columns.size} columns`;
    }
    return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  }

  if (typeof value === 'string') return `${value.length} characters`;
  if (value === null) return 'null';
  if (typeof value === 'object') return `${Object.keys(value).length} keys`;
  return String(value);
}

export function CellOutput({ run, isStale }: CellOutputProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!run) return null;

  const hasLogs = run.logs.length > 0;
  const hasOutput = run.output !== undefined && Object.keys(run.output).length > 0;
  if (!hasLogs && !hasOutput && !run.error) return null;

  const text = hasOutput ? formatValue(run.output) : '';
  const lines = text === '' ? 0 : text.split('\n').length;
  const isLong = lines > PREVIEW_LINES;

  return (
    <div className={cn('border-t border-border/60 text-[11px]', isStale && 'opacity-50')}>
      {hasLogs && (
        <div className="max-h-40 overflow-y-auto border-b border-border/40 px-3 py-2 font-mono space-y-0.5">
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
                  {run.output?.[name] !== undefined && (
                    <span className="ml-1 text-primary/60">{describe(run.output[name])}</span>
                  )}
                </span>
              ))}
            </div>
          )}

          {isLong && !isOpen ? (
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              <CaretRight size={10} />
              Show {lines} lines
            </button>
          ) : (
            <>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="mb-1 flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <CaretDown size={10} />
                  Hide
                </button>
              )}
              {/* Capped even when open: a scroll inside the cell beats a page that has
                  to be scrolled past to reach the next one. */}
              <pre
                className={cn(
                  'font-mono text-foreground/80 whitespace-pre-wrap break-words overflow-auto',
                  isLong && 'max-h-64'
                )}
              >
                {text}
              </pre>
            </>
          )}
        </div>
      )}

      {run.ms !== undefined && (
        <div className="px-3 pb-2 text-[10px] text-muted-foreground/60">{run.ms}ms</div>
      )}
    </div>
  );
}

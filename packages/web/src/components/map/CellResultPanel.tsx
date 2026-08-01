import { X } from '@phosphor-icons/react';
import type { RecordedCellResult } from '@zaa-tool/shared';
import { Button } from '../ui/button';

/**
 * What one cell did in the run being replayed.
 *
 * Shows the recorded source rather than the cell's current code, because the first
 * question about any past failure is which version produced it — and by the time you
 * are looking, the code has often already moved on.
 */
interface CellResultPanelProps {
  title: string;
  result: RecordedCellResult | undefined;
  onClose: () => void;
}

export function CellResultPanel({ title, result, onClose }: CellResultPanelProps) {
  return (
    <aside className="w-[340px] shrink-0 border-l border-border bg-background flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
            In this run
          </div>
          <div className="text-xs font-bold truncate" title={title}>
            {title}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="w-6 h-6 shrink-0" onClick={onClose}>
          <X size={13} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-[11px]">
        {!result && <div className="text-muted-foreground">This cell did not run.</div>}

        {result?.error && (
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-widest text-status-error">Error</div>
            <pre className="whitespace-pre-wrap font-mono text-[10px] text-status-error">
              {result.error}
            </pre>
          </div>
        )}

        {result?.ms !== undefined && (
          <div className="text-muted-foreground">
            {result.ms >= 1000 ? `${(result.ms / 1000).toFixed(1)}s` : `${result.ms}ms`}
          </div>
        )}

        {result?.output && Object.keys(result.output).length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
              Output
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[10px] bg-muted/30 p-2 overflow-x-auto">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          </div>
        )}

        {result?.logs && result.logs.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">Logs</div>
            <pre className="whitespace-pre-wrap font-mono text-[10px] bg-muted/30 p-2 overflow-x-auto">
              {result.logs.map((log) => log.msg).join('\n')}
            </pre>
          </div>
        )}

        {result?.source && (
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
              The code that ran
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[10px] bg-muted/30 p-2 overflow-x-auto">
              {result.source}
            </pre>
          </div>
        )}
      </div>
    </aside>
  );
}

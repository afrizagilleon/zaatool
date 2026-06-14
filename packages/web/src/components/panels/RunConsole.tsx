import { useRef, useEffect } from 'react';
import { Eraser, Terminal, Play } from '@phosphor-icons/react';
import { useEngineStore } from '../../store/engineStore';
import type { LogEntry } from '../../store/engineStore';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function LogLine({ entry }: { entry: LogEntry }) {
  const timeStr = formatTimestamp(entry.timestamp);

  const typeStyles: Record<LogEntry['type'], string> = {
    'node:start': 'text-status-running',
    'node:log': 'text-foreground/70',
    'node:done': 'text-status-done',
    'node:error': 'text-status-error',
    'flow:done': 'text-status-done font-semibold',
    system: 'text-muted-foreground/60 italic',
  };

  const badgeStyles: Record<LogEntry['type'], string> = {
    'node:start': 'bg-status-running/15 text-status-running hover:bg-status-running/25',
    'node:log': 'bg-muted text-muted-foreground hover:bg-muted',
    'node:done': 'bg-status-done/15 text-status-done hover:bg-status-done/25',
    'node:error': 'bg-status-error/15 text-status-error hover:bg-status-error/25',
    'flow:done': 'bg-status-done/15 text-status-done hover:bg-status-done/25',
    system: 'bg-muted text-muted-foreground/60 hover:bg-muted',
  };

  return (
    <div className="flex items-start gap-2 py-0.5 group animate-fade-in">
      {/* Timestamp */}
      <span className="text-[10px] text-muted-foreground/30 tabular-nums shrink-0 pt-px select-none">
        {timeStr}
      </span>

      {/* Event badge */}
      <Badge
        variant="secondary"
        className={cn(
          'text-[8px] font-semibold uppercase tracking-wide px-1.5 py-0 shrink-0 leading-none mt-px rounded-none',
          badgeStyles[entry.type],
        )}
      >
        {entry.type === 'system' ? 'sys' : entry.type.replace(':', '·')}
      </Badge>

      {/* Message */}
      <span
        className={cn('text-[11px] leading-relaxed break-all', typeStyles[entry.type])}
      >
        {entry.message}
      </span>
    </div>
  );
}

export function RunConsole() {
  const logs = useEngineStore((s) => s.logs);
  const isRunning = useEngineStore((s) => s.isRunning);
  const clearLogs = useEngineStore((s) => s.clearLogs);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      id="run-console"
      className="flex flex-col h-52 border-t border-border bg-background shrink-0 animate-slide-in-up"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-8 border-b border-border shrink-0">
        <Terminal size={12} weight="duotone" className="text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Console
        </span>

        {/* Status badge */}
        {isRunning && (
          <Badge
            variant="outline"
            className="flex items-center gap-1 text-[9px] font-medium text-status-running border-status-running/20 bg-status-running/5 px-1.5 py-0 h-5 animate-pulse-soft rounded-none"
          >
            <div className="w-1 h-1 bg-status-running" />
            Running
          </Badge>
        )}

        <div className="flex-1" />

        {/* Clear button */}
        <Button
          id="console-clear-btn"
          onClick={clearLogs}
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-muted-foreground/50 hover:text-foreground"
          title="Clear console"
        >
          <Eraser size={11} className="mr-1" />
          Clear
        </Button>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono space-y-0.5"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
            <Play size={20} className="text-muted-foreground/20" />
            <p className="text-[11px] text-muted-foreground/30">
              Press <span className="font-semibold text-muted-foreground/40">Run</span> to execute flow
            </p>
          </div>
        ) : (
          logs.map((entry) => <LogLine key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}

import { Panel } from '@xyflow/react';
import { Button } from '../ui/button';
import { Play, Spinner } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';

interface CanvasRunButtonProps {
  isRunning: boolean;
  onRun: () => void;
}

export function CanvasRunButton({ isRunning, onRun }: CanvasRunButtonProps) {
  return (
    <Panel position="top-right" className="z-50">
      <Button
        onClick={onRun}
        disabled={isRunning}
        variant="default"
        className={cn(
          'h-8 px-3 text-xs font-semibold shadow-md',
          isRunning
            ? 'bg-emerald-500/15 text-emerald-400 opacity-100 cursor-wait'
            : 'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20'
        )}
      >
        {isRunning ? (
          <>
            <Spinner size={13} className="animate-spin mr-1.5" />
            Running...
          </>
        ) : (
          <>
            <Play size={13} weight="fill" className="mr-1.5" />
            Run All Nodes
          </>
        )}
      </Button>
    </Panel>
  );
}

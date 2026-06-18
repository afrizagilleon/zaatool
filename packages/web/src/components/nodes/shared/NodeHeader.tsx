import { Code, BracketsCurly, Play } from '@phosphor-icons/react';
import { cn } from '../../../lib/utils';
import type { FlowNodeData } from '../../../store/flowStore';
import { StatusDot } from './StatusDot';

interface NodeHeaderProps {
  id: string;
  data: FlowNodeData;
  isPython: boolean;
  isVertical: boolean;
  onRun: () => void;
}

export function NodeHeader({ id, data, isPython, isVertical, onRun }: NodeHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2',
        isVertical ? 'border-y' : 'border-b',
        isPython
          ? 'border-node-code-py/20 bg-node-code-py/5'
          : 'border-node-code/20 bg-node-code/5',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center w-5 h-5',
          isPython
            ? 'bg-node-code-py/15 text-node-code-py'
            : 'bg-node-code/15 text-node-code',
        )}
      >
        {isPython ? (
          <BracketsCurly size={12} weight="duotone" />
        ) : (
          <Code size={12} weight="duotone" />
        )}
      </div>
      <span className="text-[11px] font-semibold text-foreground truncate flex-1">
        {data.label || 'Code'}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRun();
        }}
        className="flex items-center justify-center w-4 h-4 rounded hover:bg-black/10 dark:hover:bg-white/10 text-emerald-500 hover:text-emerald-600 transition-colors mr-1 shrink-0"
        title="Execute downstream from here"
      >
        <Play size={10} weight="fill" />
      </button>
      <span
        className={cn(
          'text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5',
          isPython
            ? 'bg-node-code-py/10 text-node-code-py'
            : 'bg-node-code/10 text-node-code',
        )}
      >
        {isPython ? 'PY' : 'JS'}
      </span>
      <StatusDot nodeId={id} />
    </div>
  );
}

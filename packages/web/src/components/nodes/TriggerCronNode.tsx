import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { Clock } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/uiStore';
import type { FlowNodeData } from '../../store/flowStore';

type TriggerCronNodeProps = NodeProps<Node<FlowNodeData, 'trigger:cron'>>;

export function TriggerCronNode({ id, data, selected }: TriggerCronNodeProps) {
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isVertical, updateNodeInternals]);

  const handleClass = "!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none";

  const cronExpression = typeof data.config?.cronExpression === 'string'
    ? data.config.cronExpression
    : typeof data.cronExpression === 'string'
      ? data.cronExpression
      : 'Not scheduled';
  const enabled = data.config?.enabled !== false && data.enabled !== false;

  // Render a friendly description of the cron schedule if possible
  const getScheduleDesc = (): string => {
    if (!enabled) return 'Disabled';
    const parts = String(cronExpression).trim().split(/\s+/);
    if (parts.length !== 5) return cronExpression;
    
    // Check for simple common interval patterns
    if (parts[0].startsWith('*/') && parts[1] === '*' && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
      return `Every ${parts[0].slice(2)} mins`;
    }
    if (parts[0] === '0' && parts[1].startsWith('*/') && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
      return `Every ${parts[1].slice(2)} hours`;
    }
    // Check for daily time pattern
    if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
      const min = parts[0].padStart(2, '0');
      const hour = parts[1].padStart(2, '0');
      return `Daily at ${hour}:${min}`;
    }
    
    return cronExpression;
  };

  return (
    <div
      id={`node-${id}`}
      className={cn(
        'w-44 border bg-node-bg shadow-sm transition-all relative rounded-md',
        selected ? 'border-primary ring-2 ring-primary/20 shadow-md' : 'border-node-border hover:shadow-md hover:border-border'
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20 rounded-t-md">
        <div className="flex items-center justify-center w-5 h-5 bg-amber-500/10 text-amber-500 rounded">
          <Clock size={12} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'Cron Trigger'}
        </span>
        <span className={cn(
          "text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded",
          enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
        )}>
          {enabled ? 'Active' : 'Idle'}
        </span>
      </div>

      <div className="py-3.5 px-3 flex flex-col gap-1 items-center justify-center">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest font-mono">Schedule</span>
        <span className="text-xs font-semibold text-foreground text-center truncate max-w-full font-mono bg-muted/50 px-2 py-1 rounded border border-border/60">
          {getScheduleDesc()}
        </span>
      </div>

      {isVertical ? (
        <Handle type="source" position={Position.Bottom} id="trigger" className={handleClass} />
      ) : (
        <Handle type="source" position={Position.Right} id="trigger" className={handleClass} style={{ right: -6 }} />
      )}
    </div>
  );
}

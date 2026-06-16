import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { Play } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/uiStore';
import { useFlowStore } from '../../store/flowStore';
import { useEngineStore } from '../../store/engineStore';
import type { FlowNodeData } from '../../store/flowStore';
import { Button } from '../ui/button';

type TriggerStartNodeProps = NodeProps<Node<FlowNodeData, 'trigger:start'>>;

export function TriggerStartNode({ id, data, selected }: TriggerStartNodeProps) {
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';
  const updateNodeInternals = useUpdateNodeInternals();

  const runFlow = useEngineStore((s) => s.runFlow);
  const isRunning = useEngineStore((s) => s.isRunning);
  const getGraphJson = useFlowStore((s) => s.getGraphJson);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isVertical, updateNodeInternals]);

  const handleClass = "!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none";

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) return;
    runFlow(getGraphJson(), id);
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
        <div className="flex items-center justify-center w-5 h-5 bg-emerald-500/10 text-emerald-500 rounded">
          <Play size={12} weight="bold" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'Start Trigger'}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500">START</span>
      </div>

      <div className="flex flex-col items-center justify-center py-4 px-3 gap-2">
        <Button
          onClick={handlePlay}
          disabled={isRunning}
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 w-full h-8 shadow cursor-pointer"
        >
          <Play weight="fill" className="w-3 h-3" />
          {isRunning ? 'Running...' : 'Run Flow'}
        </Button>
      </div>

      {isVertical ? (
        <Handle type="source" position={Position.Bottom} id="trigger" className={handleClass} />
      ) : (
        <Handle type="source" position={Position.Right} id="trigger" className={handleClass} style={{ right: -6 }} />
      )}
    </div>
  );
}

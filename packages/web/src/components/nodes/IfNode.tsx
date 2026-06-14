import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { useEffect } from 'react';
import { GitBranch } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { useEngineStore } from '../../store/engineStore';
import type { FlowNodeData } from '../../store/flowStore';

type IfNodeProps = NodeProps<Node<FlowNodeData, 'if'>>;

function StatusDot({ nodeId }: { nodeId: string }) {
  const status = useEngineStore((s) => s.nodeStatuses[nodeId] ?? 'idle');

  return (
    <div
      className={cn(
        'w-1.5 h-1.5 transition-colors shrink-0',
        status === 'idle' && 'bg-status-idle',
        status === 'running' && 'bg-status-running status-running-pulse',
        status === 'done' && 'bg-status-done',
        status === 'error' && 'bg-status-error',
      )}
      title={status}
    />
  );
}

export function IfNode({ id, data, selected }: IfNodeProps) {
  const inputs = data.inputsSchema || [];
  const activeHandles = useEngineStore((s) => s.activeHandles[id]);
  const isTrueActive = activeHandles?.includes('true') ?? false;
  const isFalseActive = activeHandles?.includes('false') ?? false;

  const updateNodeInternals = useUpdateNodeInternals();
  const inputsStr = JSON.stringify(inputs.map((i) => i.name));

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, inputsStr, updateNodeInternals]);

  return (
    <div
      id={`node-${id}`}
      className={cn(
        'w-56 border bg-node-bg shadow-sm transition-all',
        selected
          ? 'border-primary ring-2 ring-primary/20 shadow-md'
          : 'border-node-border hover:shadow-md hover:border-border',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-node-if/20 bg-node-if/5 ">
        <div className="flex items-center justify-center w-5 h-5 bg-node-if/15 text-node-if">
          <GitBranch size={12} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'If'}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-node-if/10 text-node-if">
          IF
        </span>
        <StatusDot nodeId={id} />
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        {/* Inputs */}
        <div className="flex flex-col gap-1.5">
          {inputs.map((input) => (
            <div key={`in-${input.name}`} className="relative flex items-center gap-1.5 h-4">
              <Handle
                type="target"
                position={Position.Left}
                id={input.name}
                className="!w-2 !h-2 !border-[1.5px] !border-node-bg !bg-handle !-left-[13px] ! hover:!bg-primary transition-colors"
              />
              <span className="text-[10px] text-muted-foreground truncate">
                {input.name}
              </span>
              <span className="text-[8px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                {input.type}
              </span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="h-px bg-border/50" />

        {/* Outputs: true and false */}
        <div className="flex flex-col gap-1.5">
          <div className="relative flex items-center justify-end gap-1.5 h-4">
            <span
              className={cn(
                'text-[10px] font-medium transition-colors',
                isTrueActive ? 'text-status-done' : 'text-muted-foreground',
              )}
            >
              true
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id="true"
              className={cn(
                '!w-2 !h-2 !border-[1.5px] !border-node-bg !-right-[13px] ! hover:!bg-primary transition-colors',
                isTrueActive ? '!bg-status-done' : '!bg-handle',
              )}
            />
          </div>
          <div className="relative flex items-center justify-end gap-1.5 h-4">
            <span
              className={cn(
                'text-[10px] font-medium transition-colors',
                isFalseActive ? 'text-status-error' : 'text-muted-foreground',
              )}
            >
              false
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id="false"
              className={cn(
                '!w-2 !h-2 !border-[1.5px] !border-node-bg !-right-[13px] ! hover:!bg-primary transition-colors',
                isFalseActive ? '!bg-status-error' : '!bg-handle',
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

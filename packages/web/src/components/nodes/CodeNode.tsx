import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { Code, BracketsCurly } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useEngineStore } from '../../store/engineStore';
import { useUiStore } from '../../store/uiStore';
import type { FlowNodeData } from '../../store/flowStore';

type CodeNodeProps = NodeProps<Node<FlowNodeData, 'code'>>;

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

export function CodeNode({ id, data, selected }: CodeNodeProps) {
  const inputs = data.inputsSchema || [];
  const outputs = data.outputsSchema || [];
  const runtime = data.runtime ?? 'node';
  const isPython = runtime === 'python';

  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';

  const updateNodeInternals = useUpdateNodeInternals();
  const inputsStr = JSON.stringify(inputs.map((i) => i.name));
  const outputsStr = JSON.stringify(outputs.map((o) => o.name));

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, inputsStr, outputsStr, isVertical, updateNodeInternals]);

  if (isVertical) {
    return (
      <div
        id={`node-${id}`}
        className={cn(
          'min-w-48 border bg-node-bg shadow-sm transition-all',
          selected
            ? 'border-primary ring-2 ring-primary/20 shadow-md'
            : 'border-node-border hover:shadow-md hover:border-border',
        )}
      >
        {/* Top: Input handles */}
        {inputs.map((input, idx) => (
          <Handle
            key={`handle-in-${input.name}`}
            type="target"
            position={Position.Top}
            id={input.name}
            style={{ left: `${((idx + 1) / (inputs.length + 1)) * 100}%` }}
            className="!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none"
          />
        ))}

        {inputs.length > 0 && (
          <div className="flex justify-center gap-6 px-3 pt-3 pb-1">
            {inputs.map((input) => (
              <div key={`in-${input.name}`} className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] text-muted-foreground truncate max-w-16">
                  {input.name}
                </span>
                <span className="text-[7px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                  {input.type}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Middle: Node header/info */}
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2 border-y',
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

        {/* Bottom: Output handles */}
        {outputs.map((output, idx) => (
          <Handle
            key={`handle-out-${output.name}`}
            type="source"
            position={Position.Bottom}
            id={output.name}
            style={{ left: `${((idx + 1) / (outputs.length + 1)) * 100}%` }}
            className="!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none"
          />
        ))}

        {outputs.length > 0 && (
          <div className="flex justify-center gap-6 px-3 pt-1 pb-3">
            {outputs.map((output) => (
              <div key={`out-${output.name}`} className="flex flex-col items-center">
                <span className="text-[7px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                  {output.type}
                </span>
                <span className="text-[9px] text-muted-foreground truncate max-w-16">
                  {output.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Horizontal layout (LR) — original design
  return (
    <div
      id={`node-${id}`}
      className={cn(
        'w-60 border bg-node-bg shadow-sm transition-all',
        selected
          ? 'border-primary ring-2 ring-primary/20 shadow-md'
          : 'border-node-border hover:shadow-md hover:border-border',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 border-b ',
          isPython
            ? 'border-node-code-py/20 bg-node-code-py/5'
            : 'border-node-code/20 bg-node-code/5',
        )}
      >
        <div
          className={cn(
            'flex items-center justify-center w-5 h-5 ',
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
        <span
          className={cn(
            'text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 ',
            isPython
              ? 'bg-node-code-py/10 text-node-code-py'
              : 'bg-node-code/10 text-node-code',
          )}
        >
          {isPython ? 'PY' : 'JS'}
        </span>
        <StatusDot nodeId={id} />
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        {/* Ports */}
        <div className="flex justify-between gap-4">
          {/* Inputs */}
          <div className="flex flex-col gap-1.5 min-w-0">
            {inputs.map((input) => (
              <div key={`in-${input.name}`} className="relative flex items-center gap-1.5 h-4">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={input.name}
                  className="!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !-left-[12px] !rounded-none"
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

          {/* Outputs */}
          <div className="flex flex-col gap-1.5 items-end min-w-0">
            {outputs.map((output) => (
              <div key={`out-${output.name}`} className="relative flex items-center gap-1.5 h-4 justify-end">
                <span className="text-[8px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                  {output.type}
                </span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {output.name}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={output.name}
                  className="!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !-right-[12px] !rounded-none"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

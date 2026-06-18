import { Handle, Position } from '@xyflow/react';
import { cn } from '../../../lib/utils';

interface NodeHandleProps {
  name: string;
  type: string;
  direction: 'input' | 'output';
  isVertical: boolean;
  index: number;
  count: number;
}

const HANDLE_CLASS =
  '!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none';

export function NodeHandle({ name, type, direction, isVertical, index, count }: NodeHandleProps) {
  const isInput = direction === 'input';

  if (isVertical) {
    const xflowType = isInput ? 'target' : 'source';
    const position = isInput ? Position.Top : Position.Bottom;
    const style = { left: `${((index + 1) / (count + 1)) * 100}%` };

    return (
      <Handle
        type={xflowType}
        position={position}
        id={name}
        style={style}
        className={HANDLE_CLASS}
      />
    );
  }

  if (isInput) {
    return (
      <div className="relative flex items-center gap-1.5 h-4">
        <Handle
          type="target"
          position={Position.Left}
          id={name}
          className={cn(HANDLE_CLASS, '!-left-[12px]')}
        />
        <span className="text-[10px] text-muted-foreground truncate">{name}</span>
        <span className="text-[8px] font-medium text-muted-foreground/50 uppercase tracking-wide">
          {type}
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-1.5 h-4 justify-end">
      <span className="text-[8px] font-medium text-muted-foreground/50 uppercase tracking-wide">
        {type}
      </span>
      <span className="text-[10px] text-muted-foreground truncate">{name}</span>
      <Handle
        type="source"
        position={Position.Right}
        id={name}
        className={cn(HANDLE_CLASS, '!-right-[12px]')}
      />
    </div>
  );
}

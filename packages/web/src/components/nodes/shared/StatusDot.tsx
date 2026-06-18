import { cn } from '../../../lib/utils';
import { useEngineStore } from '../../../store/engineStore';

interface StatusDotProps {
  nodeId: string;
}

export function StatusDot({ nodeId }: StatusDotProps) {
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

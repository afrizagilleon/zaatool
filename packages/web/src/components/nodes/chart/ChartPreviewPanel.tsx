import type { ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '../../../lib/utils';
import type { FlowNodeData } from '../../../store/flowStore';

interface ChartPreviewPanelProps {
  showPanel: boolean;
  isVertical: boolean;
  data: FlowNodeData;
  chartConfig: NonNullable<FlowNodeData['chartConfig']>;
  children: ReactNode;
}

export function ChartPreviewPanel({
  showPanel,
  isVertical,
  data,
  chartConfig,
  children,
}: ChartPreviewPanelProps) {
  if (!showPanel) return null;

  return (
    <div
      className={cn(
        'nodrag nowheel absolute bg-card text-card-foreground shadow-lg border border-border p-4 rounded-md w-[460px] h-[340px] z-10 flex flex-col',
        isVertical ? 'top-0 left-full ml-4' : 'top-full mt-4 left-0',
      )}
    >
      <div className="text-xs font-semibold mb-2 pb-2 border-b border-border flex justify-between items-center shrink-0">
        <span>{data.label || 'Chart Display Preview'}</span>
        <span className="text-[10px] text-muted-foreground font-normal uppercase">
          {chartConfig.type || 'bar'} Chart
        </span>
      </div>

      <div className="flex-1 min-h-0 w-full h-full">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

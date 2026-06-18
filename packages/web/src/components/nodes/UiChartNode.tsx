import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { ChartBar, Eye, EyeSlash } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/uiStore';
import { useFlowStore } from '../../store/flowStore';
import type { FlowNodeData } from '../../store/flowStore';
import { useChartData } from './chart/useChartData';
import { ChartRenderer } from './chart/ChartRenderer';
import { ChartPreviewPanel } from './chart/ChartPreviewPanel';

type UiChartNodeProps = NodeProps<Node<FlowNodeData, 'ui:chart'>>;

const handleClass =
  '!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none';

export function UiChartNode({ id, data, selected }: UiChartNodeProps) {
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNodeData = useFlowStore((s) => s.updateNodeData);

  const showPanel = data.showPanel !== false;
  const setShowPanel = (show: boolean) => updateNodeData(id, { showPanel: show });

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isVertical, updateNodeInternals]);

  const { rawData, xAxisKey, yAxisKeys, advancedConfig, chartColors, chartConfig } =
    useChartData(data);

  const preview = (
    <ChartPreviewPanel
      showPanel={showPanel}
      isVertical={isVertical}
      data={data}
      chartConfig={chartConfig}
    >
      <ChartRenderer
        rawData={rawData}
        xAxisKey={xAxisKey}
        yAxisKeys={yAxisKeys}
        advancedConfig={advancedConfig}
        chartColors={chartColors}
        chartType={chartConfig.type || 'bar'}
      />
    </ChartPreviewPanel>
  );

  const toggleBtn = (
    <button
      onClick={() => setShowPanel(!showPanel)}
      className="text-muted-foreground hover:text-foreground transition-colors outline-none"
      title={showPanel ? 'Hide Panel' : 'Show Panel'}
    >
      {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
    </button>
  );

  if (isVertical) {
    return (
      <div
        id={`node-${id}`}
        className={cn(
          'min-w-48 border bg-node-bg shadow-sm transition-all relative',
          selected
            ? 'border-primary ring-2 ring-primary/20 shadow-md'
            : 'border-node-border hover:shadow-md hover:border-border',
        )}
      >
        <Handle type="target" position={Position.Top} id="data" style={{ left: '50%' }} className={handleClass} />

        <div className="flex justify-center px-3 pt-3 pb-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground">data</span>
            <span className="text-[7px] font-medium text-muted-foreground/50 uppercase">ARRAY / TABLE</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-y border-border/50 bg-muted/20">
          <div className="flex items-center justify-center w-5 h-5 bg-purple-500/10 text-purple-500">
            <ChartBar size={14} weight="duotone" />
          </div>
          <span className="text-[11px] font-semibold text-foreground truncate flex-1">
            {data.label || 'Chart Display'}
          </span>
          {toggleBtn}
          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-purple-500/10 text-purple-500">UI</span>
        </div>

        <div className="h-6" />
        {preview}
      </div>
    );
  }

  return (
    <div
      id={`node-${id}`}
      className={cn(
        'w-48 border bg-node-bg shadow-sm transition-all relative',
        selected
          ? 'border-primary ring-2 ring-primary/20 shadow-md'
          : 'border-node-border hover:shadow-md hover:border-border',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
        <div className="flex items-center justify-center w-5 h-5 bg-purple-500/10 text-purple-500">
          <ChartBar size={14} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'Chart Display'}
        </span>
        {toggleBtn}
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-purple-500/10 text-purple-500">UI</span>
      </div>

      <div className="px-3 py-2">
        <div className="relative flex items-center gap-1.5 h-4">
          <Handle type="target" position={Position.Left} id="data" className={cn(handleClass, '!left-[-12px]')} style={{ left: -15 }} />
          <span className="text-[10px] text-muted-foreground">data</span>
        </div>
      </div>

      {preview}
    </div>
  );
}

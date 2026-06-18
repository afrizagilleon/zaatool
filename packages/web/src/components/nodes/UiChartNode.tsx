import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { ChartBar, Eye, EyeSlash } from '@phosphor-icons/react';
import { useEffect, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/uiStore';
import { useFlowStore } from '../../store/flowStore';
import type { FlowNodeData } from '../../store/flowStore';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

type UiChartNodeProps = NodeProps<Node<FlowNodeData, 'ui:chart'>>;

const MOCK_DATA = [
  { name: 'Jan', sales: 400, profit: 240, cost: 160 },
  { name: 'Feb', sales: 300, profit: 139, cost: 161 },
  { name: 'Mar', sales: 200, profit: 980, cost: 220 },
  { name: 'Apr', sales: 278, profit: 390.8, cost: 180 },
  { name: 'May', sales: 189, profit: 480, cost: 190 },
  { name: 'Jun', sales: 239, profit: 380, cost: 250 },
];

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function UiChartNode({ id, data, selected }: UiChartNodeProps) {
  const chartConfig = data.chartConfig || { type: 'bar' };
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';
  const updateNodeInternals = useUpdateNodeInternals();

  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const showPanel = data.showPanel !== false;
  const setShowPanel = (show: boolean) => {
    updateNodeData(id, { showPanel: show });
  };

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isVertical, updateNodeInternals]);

  const rawData = useMemo(() => {
    const inputData = data.inputs?.data;
    if (Array.isArray(inputData) && inputData.length > 0) {
      return inputData;
    }
    return MOCK_DATA;
  }, [data.inputs?.data]);

  // Auto detect keys if not specified
  const { xAxisKey, yAxisKeys } = useMemo(() => {
    let xKey = chartConfig.xAxisKey || '';
    let yKeys = chartConfig.yAxisKeys || [];

    if (rawData.length > 0) {
      const firstRow = rawData[0];
      if (typeof firstRow === 'object' && firstRow !== null) {
        const keys = Object.keys(firstRow);
        
        // Find xKey if empty
        if (!xKey) {
          // Look for string or name key
          const stringKey = keys.find(k => typeof firstRow[k] === 'string');
          xKey = stringKey || keys[0] || '';
        }

        // Find yKeys if empty
        if (yKeys.length === 0) {
          yKeys = keys.filter(k => k !== xKey && typeof firstRow[k] === 'number');
          if (yKeys.length === 0 && keys.length > 1) {
            const foundY = keys.find(k => k !== xKey);
            yKeys = foundY ? [foundY] : [];
          }
        }
      }
    }

    return { xAxisKey: xKey, yAxisKeys: yKeys };
  }, [rawData, chartConfig.xAxisKey, chartConfig.yAxisKeys]);

  // Parse custom advanced JSON layout config
  const advancedConfig = useMemo(() => {
    if (!chartConfig.jsonConfig) return {};
    try {
      return JSON.parse(chartConfig.jsonConfig);
    } catch (e) {
      console.warn("Invalid Advanced JSON Config in Chart Node:", e);
      return {};
    }
  }, [chartConfig.jsonConfig]);

  const chartColors = chartConfig.colors && chartConfig.colors.length > 0
    ? chartConfig.colors
    : DEFAULT_COLORS;

  const handleClass = "!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none";

  const renderChart = () => {
    const type = chartConfig.type || 'bar';

    const defaultYAxisTickFormatter = (value: any) => {
      if (typeof value === 'number') {
        return new Intl.NumberFormat().format(value);
      }
      return value;
    };
    const defaultTooltipFormatter = (value: any) => {
      return typeof value === 'number' ? new Intl.NumberFormat().format(value) : value;
    };

    // Apply basic custom options from advancedConfig
    const gridProps = { stroke: "var(--border)", strokeDasharray: "3 3", ...(advancedConfig.grid || {}) };
    const xAxisProps = { dataKey: xAxisKey, stroke: "var(--muted-foreground)", fontSize: 10, tickLine: false, axisLine: false, ...(advancedConfig.xAxis || {}) };
    const yAxisProps = {
      stroke: "var(--muted-foreground)",
      fontSize: 10,
      tickLine: false,
      axisLine: false,
      tickFormatter: defaultYAxisTickFormatter,
      ...(advancedConfig.yAxis || {})
    };
    const tooltipProps = {
      contentStyle: {
        backgroundColor: "var(--popover)",
        borderColor: "var(--border)",
        color: "var(--popover-foreground)",
        borderRadius: "var(--radius)",
        fontSize: "11px"
      },
      formatter: defaultTooltipFormatter,
      ...(advancedConfig.tooltip || {})
    };
    const legendProps = {
      wrapperStyle: { fontSize: "10px", marginTop: "4px" },
      ...(advancedConfig.legend || {})
    };

    if (type === 'pie') {
      const pieData = rawData.map(d => ({
        name: String(d[xAxisKey] || ''),
        value: Number(d[yAxisKeys[0] || ''] || 0)
      }));

      const pieProps = {
        data: pieData,
        cx: "50%",
        cy: "50%",
        outerRadius: 80,
        fill: chartColors[0],
        dataKey: "value",
        label: { fontSize: 10, fill: "var(--foreground)" },
        ...(advancedConfig.pie || {})
      };

      return (
        <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <Pie {...pieProps}>
            {pieData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipProps} />
          <Legend {...legendProps} />
        </PieChart>
      );
    }

    if (type === 'line') {
      return (
        <LineChart data={rawData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip {...tooltipProps} />
          <Legend {...legendProps} />
          {yAxisKeys.map((key, index) => {
            const lineProps = {
              type: "monotone" as const,
              dataKey: key,
              stroke: chartColors[index % chartColors.length],
              strokeWidth: 2,
              dot: { r: 3 },
              activeDot: { r: 5 },
              ...(advancedConfig.line || {})
            };
            return <Line key={key} {...lineProps} />;
          })}
        </LineChart>
      );
    }

    if (type === 'area') {
      return (
        <AreaChart data={rawData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip {...tooltipProps} />
          <Legend {...legendProps} />
          {yAxisKeys.map((key, index) => {
            const areaColor = chartColors[index % chartColors.length];
            const areaProps = {
              type: "monotone" as const,
              dataKey: key,
              stroke: areaColor,
              fill: areaColor,
              fillOpacity: 0.2,
              strokeWidth: 2,
              ...(advancedConfig.area || {})
            };
            return <Area key={key} {...areaProps} />;
          })}
        </AreaChart>
      );
    }

    // Default: 'bar'
    return (
      <BarChart data={rawData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis {...xAxisProps} />
        <YAxis {...yAxisProps} />
        <Tooltip {...tooltipProps} />
        <Legend {...legendProps} />
        {yAxisKeys.map((key, index) => {
          const barProps = {
            dataKey: key,
            fill: chartColors[index % chartColors.length],
            radius: [4, 4, 0, 0] as [number, number, number, number],
            ...(advancedConfig.bar || {})
          };
          return <Bar key={key} {...barProps} />;
        })}
      </BarChart>
    );
  };

  const renderChartPreview = () => {
    if (!showPanel) return null;

    return (
      <div className={cn(
        "nodrag nowheel absolute bg-card text-card-foreground shadow-lg border border-border p-4 rounded-md w-[460px] h-[340px] z-10 flex flex-col",
        isVertical ? "top-0 left-full ml-4" : "top-full mt-4 left-0"
      )}>
        <div className="text-xs font-semibold mb-2 pb-2 border-b border-border flex justify-between items-center shrink-0">
          <span>{data.label || 'Chart Display Preview'}</span>
          <span className="text-[10px] text-muted-foreground font-normal uppercase">
            {chartConfig.type || 'bar'} Chart
          </span>
        </div>

        <div className="flex-1 min-h-0 w-full h-full">
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  if (isVertical) {
    return (
      <div
        id={`node-${id}`}
        className={cn(
          'min-w-48 border bg-node-bg shadow-sm transition-all relative',
          selected ? 'border-primary ring-2 ring-primary/20 shadow-md' : 'border-node-border hover:shadow-md hover:border-border'
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
          <button
            onClick={() => setShowPanel(!showPanel)}
            className="text-muted-foreground hover:text-foreground transition-colors outline-none"
            title={showPanel ? "Hide Panel" : "Show Panel"}
          >
            {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
          </button>
          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-purple-500/10 text-purple-500">UI</span>
        </div>

        <div className="h-6" />

        {renderChartPreview()}
      </div>
    );
  }

  // Horizontal layout
  return (
    <div
      id={`node-${id}`}
      className={cn(
        'w-48 border bg-node-bg shadow-sm transition-all relative',
        selected ? 'border-primary ring-2 ring-primary/20 shadow-md' : 'border-node-border hover:shadow-md hover:border-border'
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
        <div className="flex items-center justify-center w-5 h-5 bg-purple-500/10 text-purple-500">
          <ChartBar size={14} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'Chart Display'}
        </span>
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="text-muted-foreground hover:text-foreground transition-colors outline-none"
          title={showPanel ? "Hide Panel" : "Show Panel"}
        >
          {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
        </button>
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-purple-500/10 text-purple-500">UI</span>
      </div>

      <div className="px-3 py-2">
        <div className="relative flex items-center gap-1.5 h-4">
          <Handle type="target" position={Position.Left} id="data" className={cn(handleClass, "!left-[-12px]")} style={{ left: -15 }} />
          <span className="text-[10px] text-muted-foreground">data</span>
        </div>
      </div>

      {renderChartPreview()}
    </div>
  );
}

import { ResponsiveContainer } from 'recharts';
import { PieChartWidget } from './charts/PieChartWidget';
import { LineChartWidget } from './charts/LineChartWidget';
import { AreaChartWidget } from './charts/AreaChartWidget';
import { BarChartWidget } from './charts/BarChartWidget';

interface DashboardChartWidgetProps {
  node: any;
  data: any;
  outputs: any;
  fontSize?: number;
}

export function DashboardChartWidget({ node: _node, data, outputs, fontSize }: DashboardChartWidgetProps) {
  const rawData = outputs.data || data.inputs?.data;
  const chartConfig = data.chartConfig || {};
  const advancedConfig = (() => {
    if (!chartConfig.jsonConfig) return {};
    try {
      return JSON.parse(chartConfig.jsonConfig);
    } catch (e) {
      return {};
    }
  })();

  const finalData = Array.isArray(rawData) && rawData.length > 0
    ? rawData
    : [
      { name: 'Jan', value: 400, profit: 240, cost: 160 },
      { name: 'Feb', value: 300, profit: 139, cost: 161 },
      { name: 'Mar', value: 200, profit: 980, cost: 220 },
      { name: 'Apr', value: 278, profit: 390, cost: 180 },
      { name: 'May', value: 189, profit: 480, cost: 190 },
      { name: 'Jun', value: 239, profit: 380, cost: 250 },
    ];

  let xAxisKey = chartConfig.xAxisKey || '';
  let yAxisKeys = chartConfig.yAxisKeys || [];

  if (finalData.length > 0) {
    const firstRow = finalData[0];
    if (typeof firstRow === 'object' && firstRow !== null) {
      const keys = Object.keys(firstRow);
      if (!xAxisKey) {
        const stringKey = keys.find(k => typeof firstRow[k] === 'string');
        xAxisKey = stringKey || keys[0] || '';
      }
      if (yAxisKeys.length === 0) {
        yAxisKeys = keys.filter(k => k !== xAxisKey && typeof firstRow[k] === 'number');
        if (yAxisKeys.length === 0 && keys.length > 1) {
          const foundY = keys.find(k => k !== xAxisKey);
          yAxisKeys = foundY ? [foundY] : [];
        }
      }
    }
  }

  const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  const chartColors = chartConfig.colors && chartConfig.colors.length > 0
    ? chartConfig.colors
    : DEFAULT_COLORS;

  const currentFontSize = fontSize || 10;
  const typeOfChart = chartConfig.type || 'bar';

  const defaultYAxisTickFormatter = (value: any) => {
    if (typeof value === 'number') {
      return new Intl.NumberFormat().format(value);
    }
    return value;
  };
  const defaultTooltipFormatter = (value: any) => {
    return typeof value === 'number' ? new Intl.NumberFormat().format(value) : value;
  };

  const gridProps = { stroke: "var(--border)", strokeDasharray: "3 3", ...(advancedConfig.grid || {}) };
  const xAxisProps = { dataKey: xAxisKey, stroke: "var(--muted-foreground)", fontSize: currentFontSize, tickLine: false, axisLine: false, ...(advancedConfig.xAxis || {}) };
  const yAxisProps = {
    stroke: "var(--muted-foreground)",
    fontSize: currentFontSize,
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
      fontSize: `${currentFontSize}px`
    },
    formatter: defaultTooltipFormatter,
    ...(advancedConfig.tooltip || {})
  };
  const legendProps = {
    wrapperStyle: { fontSize: `${currentFontSize}px`, marginTop: "4px" },
    ...(advancedConfig.legend || {})
  };

  return (
    <div className="flex-1 min-h-0 w-full h-full relative p-2">
      <ResponsiveContainer width="100%" height="100%">
        {(() => {
          if (typeOfChart === 'pie') {
            const pieData = finalData.map(d => ({
              name: String(d[xAxisKey] || ''),
              value: Number(d[yAxisKeys[0] || ''] || 0)
            }));
            return (
              <PieChartWidget
                pieData={pieData}
                chartColors={chartColors}
                currentFontSize={currentFontSize}
                advancedConfig={advancedConfig}
                tooltipProps={tooltipProps}
                legendProps={legendProps}
              />
            );
          }

          if (typeOfChart === 'line') {
            return (
              <LineChartWidget
                finalData={finalData}
                xAxisProps={xAxisProps}
                yAxisProps={yAxisProps}
                gridProps={gridProps}
                tooltipProps={tooltipProps}
                legendProps={legendProps}
                yAxisKeys={yAxisKeys}
                chartColors={chartColors}
                advancedConfig={advancedConfig}
              />
            );
          }

          if (typeOfChart === 'area') {
            return (
              <AreaChartWidget
                finalData={finalData}
                xAxisProps={xAxisProps}
                yAxisProps={yAxisProps}
                gridProps={gridProps}
                tooltipProps={tooltipProps}
                legendProps={legendProps}
                yAxisKeys={yAxisKeys}
                chartColors={chartColors}
                advancedConfig={advancedConfig}
              />
            );
          }

          // Default: bar
          return (
            <BarChartWidget
              finalData={finalData}
              xAxisProps={xAxisProps}
              yAxisProps={yAxisProps}
              gridProps={gridProps}
              tooltipProps={tooltipProps}
              legendProps={legendProps}
              yAxisKeys={yAxisKeys}
              chartColors={chartColors}
              advancedConfig={advancedConfig}
            />
          );
        })()}
      </ResponsiveContainer>
    </div>
  );
}

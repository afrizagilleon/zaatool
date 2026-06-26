import { BarChartWidget } from '../../dashboard/charts/BarChartWidget';
import { LineChartWidget } from '../../dashboard/charts/LineChartWidget';
import { AreaChartWidget } from '../../dashboard/charts/AreaChartWidget';
import { PieChartWidget } from '../../dashboard/charts/PieChartWidget';

interface ChartRendererProps {
  rawData: any[];
  xAxisKey: string;
  yAxisKeys: string[];
  advancedConfig: any;
  chartColors: string[];
  chartType: string;
}

const defaultYAxisTickFormatter = (value: any) => {
  if (typeof value === 'number') {
    return new Intl.NumberFormat().format(value);
  }
  return value;
};

const defaultTooltipFormatter = (value: any) =>
  typeof value === 'number' ? new Intl.NumberFormat().format(value) : value;

function buildCommonProps(xAxisKey: string, advancedConfig: any) {
  const gridProps = {
    stroke: 'var(--border)',
    strokeDasharray: '3 3',
    ...(advancedConfig.grid || {}),
  };
  const xAxisProps = {
    dataKey: xAxisKey,
    stroke: 'var(--muted-foreground)',
    fontSize: 10,
    tickLine: false,
    axisLine: false,
    ...(advancedConfig.xAxis || {}),
  };
  const yAxisProps = {
    stroke: 'var(--muted-foreground)',
    fontSize: 10,
    tickLine: false,
    axisLine: false,
    tickFormatter: defaultYAxisTickFormatter,
    ...(advancedConfig.yAxis || {}),
  };
  const tooltipProps = {
    contentStyle: {
      backgroundColor: 'var(--popover)',
      borderColor: 'var(--border)',
      color: 'var(--popover-foreground)',
      borderRadius: 'var(--radius)',
      fontSize: '11px',
    },
    formatter: defaultTooltipFormatter,
    ...(advancedConfig.tooltip || {}),
  };
  const legendProps = {
    wrapperStyle: { fontSize: '10px', marginTop: '4px' },
    ...(advancedConfig.legend || {}),
  };
  return { gridProps, xAxisProps, yAxisProps, tooltipProps, legendProps };
}

export function ChartRenderer({
  rawData,
  xAxisKey,
  yAxisKeys,
  advancedConfig,
  chartColors,
  chartType,
}: ChartRendererProps) {
  const { gridProps, xAxisProps, yAxisProps, tooltipProps, legendProps } = buildCommonProps(
    xAxisKey,
    advancedConfig,
  );

  if (chartType === 'pie') {
    const pieData = rawData.map(d => ({
      name: String(d[xAxisKey] || ''),
      value: Number(d[yAxisKeys[0] || ''] || 0),
    }));

    return (
      <PieChartWidget
        pieData={pieData}
        chartColors={chartColors}
        currentFontSize={10}
        advancedConfig={advancedConfig}
        tooltipProps={tooltipProps}
        legendProps={legendProps}
      />
    );
  }

  if (chartType === 'line') {
    return (
      <LineChartWidget
        finalData={rawData}
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

  if (chartType === 'area') {
    return (
      <AreaChartWidget
        finalData={rawData}
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

  return (
    <BarChartWidget
      finalData={rawData}
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

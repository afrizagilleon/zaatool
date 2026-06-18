import { BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';

interface BarChartWidgetProps {
  finalData: any[];
  xAxisProps: any;
  yAxisProps: any;
  gridProps: any;
  tooltipProps: any;
  legendProps: any;
  yAxisKeys: string[];
  chartColors: string[];
  advancedConfig: any;
}

export function BarChartWidget({
  finalData,
  xAxisProps,
  yAxisProps,
  gridProps,
  tooltipProps,
  legendProps,
  yAxisKeys,
  chartColors,
  advancedConfig
}: BarChartWidgetProps) {
  return (
    <BarChart data={finalData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
      <CartesianGrid {...gridProps} />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip {...tooltipProps} />
      <Legend {...legendProps} />
      {yAxisKeys.map((key: string, index: number) => {
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
}

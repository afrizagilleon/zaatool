import { LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } from 'recharts';

interface LineChartWidgetProps {
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

export function LineChartWidget({
  finalData,
  xAxisProps,
  yAxisProps,
  gridProps,
  tooltipProps,
  legendProps,
  yAxisKeys,
  chartColors,
  advancedConfig
}: LineChartWidgetProps) {
  return (
    <LineChart data={finalData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
      <CartesianGrid {...gridProps} />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip {...tooltipProps} />
      <Legend {...legendProps} />
      {yAxisKeys.map((key: string, index: number) => {
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

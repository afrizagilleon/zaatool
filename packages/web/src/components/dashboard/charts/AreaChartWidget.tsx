import { AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Area } from 'recharts';

interface AreaChartWidgetProps {
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

export function AreaChartWidget({
  finalData,
  xAxisProps,
  yAxisProps,
  gridProps,
  tooltipProps,
  legendProps,
  yAxisKeys,
  chartColors,
  advancedConfig
}: AreaChartWidgetProps) {
  return (
    <AreaChart data={finalData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
      <CartesianGrid {...gridProps} />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip {...tooltipProps} />
      <Legend {...legendProps} />
      {yAxisKeys.map((key: string, index: number) => {
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

import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

interface PieChartWidgetProps {
  pieData: any[];
  chartColors: string[];
  currentFontSize: number;
  advancedConfig: any;
  tooltipProps: any;
  legendProps: any;
}

export function PieChartWidget({
  pieData,
  chartColors,
  currentFontSize,
  advancedConfig,
  tooltipProps,
  legendProps
}: PieChartWidgetProps) {
  const pieProps = {
    data: pieData,
    cx: "50%",
    cy: "50%",
    outerRadius: "70%",
    fill: chartColors[0],
    dataKey: "value",
    label: { fontSize: currentFontSize, fill: "var(--foreground)" },
    ...(advancedConfig.pie || {})
  };

  return (
    <PieChart margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
      <Pie {...pieProps}>
        {pieData.map((_, index: number) => (
          <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
        ))}
      </Pie>
      <Tooltip {...tooltipProps} />
      <Legend {...legendProps} />
    </PieChart>
  );
}

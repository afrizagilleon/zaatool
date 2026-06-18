import { useMemo } from 'react';
import type { FlowNodeData } from '../../../store/flowStore';

const MOCK_DATA = [
  { name: 'Jan', sales: 400, profit: 240, cost: 160 },
  { name: 'Feb', sales: 300, profit: 139, cost: 161 },
  { name: 'Mar', sales: 200, profit: 980, cost: 220 },
  { name: 'Apr', sales: 278, profit: 390.8, cost: 180 },
  { name: 'May', sales: 189, profit: 480, cost: 190 },
  { name: 'Jun', sales: 239, profit: 380, cost: 250 },
];

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export interface ChartData {
  rawData: any[];
  xAxisKey: string;
  yAxisKeys: string[];
  advancedConfig: any;
  chartColors: string[];
  chartConfig: NonNullable<FlowNodeData['chartConfig']>;
}

export function useChartData(data: FlowNodeData): ChartData {
  const chartConfig = data.chartConfig || { type: 'bar' };

  const rawData = useMemo(() => {
    const inputData = data.inputs?.data;
    if (Array.isArray(inputData) && inputData.length > 0) {
      return inputData;
    }
    return MOCK_DATA;
  }, [data.inputs?.data]);

  const { xAxisKey, yAxisKeys } = useMemo(() => {
    let xKey = chartConfig.xAxisKey || '';
    let yKeys = chartConfig.yAxisKeys || [];

    if (rawData.length > 0) {
      const firstRow = rawData[0];
      if (typeof firstRow === 'object' && firstRow !== null) {
        const keys = Object.keys(firstRow);

        if (!xKey) {
          const stringKey = keys.find(k => typeof firstRow[k] === 'string');
          xKey = stringKey || keys[0] || '';
        }

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

  const advancedConfig = useMemo(() => {
    if (!chartConfig.jsonConfig) return {};
    try {
      return JSON.parse(chartConfig.jsonConfig);
    } catch (e) {
      console.warn('Invalid Advanced JSON Config in Chart Node:', e);
      return {};
    }
  }, [chartConfig.jsonConfig]);

  const chartColors =
    chartConfig.colors && chartConfig.colors.length > 0 ? chartConfig.colors : DEFAULT_COLORS;

  return { rawData, xAxisKey, yAxisKeys, advancedConfig, chartColors, chartConfig };
}

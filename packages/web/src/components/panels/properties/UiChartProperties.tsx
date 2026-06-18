import { useFlowStore } from '../../../store/flowStore';
import type { UiChartConfig } from '@zaa-tool/shared';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';

export function UiChartProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const chartConfig: UiChartConfig = node.data.chartConfig || { type: 'bar' };

  const updateConfig = (newConfig: Partial<UiChartConfig>) => {
    updateNodeData(nodeId, { chartConfig: { ...chartConfig, ...newConfig } });
  };

  const handleYAxisChange = (val: string) => {
    const keys = val.split(',').map(k => k.trim()).filter(Boolean);
    updateConfig({ yAxisKeys: keys });
  };

  const handleColorsChange = (val: string) => {
    const colors = val.split(',').map(c => c.trim()).filter(Boolean);
    updateConfig({ colors });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Chart Configuration</span>

        <div className="space-y-2">
          <Label className="text-xs">Chart Type</Label>
          <Select 
            value={chartConfig.type || 'bar'} 
            onValueChange={(v: 'bar'|'line'|'area'|'pie') => updateConfig({ type: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bar">Bar Chart</SelectItem>
              <SelectItem value="line">Line Chart</SelectItem>
              <SelectItem value="area">Area Chart</SelectItem>
              <SelectItem value="pie">Pie Chart</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">X-Axis Key</Label>
          <Input 
            placeholder="e.g. name or month (Auto-detected if blank)" 
            value={chartConfig.xAxisKey || ''} 
            onChange={(e) => updateConfig({ xAxisKey: e.target.value })}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Y-Axis Series (comma-separated)</Label>
          <Input 
            placeholder="e.g. sales, profit (Auto-detected if blank)" 
            value={chartConfig.yAxisKeys?.join(', ') || ''} 
            onChange={(e) => handleYAxisChange(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Colors (comma-separated hex)</Label>
          <Input 
            placeholder="e.g. #3b82f6, #10b981" 
            value={chartConfig.colors?.join(', ') || ''} 
            onChange={(e) => handleColorsChange(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-xs">Advanced JSON Config</Label>
            <span className="text-[9px] text-muted-foreground font-normal">Optional</span>
          </div>
          <Textarea 
            placeholder='e.g. { "grid": { "strokeDasharray": "5 5" }, "line": { "strokeWidth": 3 } }' 
            value={chartConfig.jsonConfig || ''} 
            onChange={(e) => updateConfig({ jsonConfig: e.target.value })}
            className="font-mono text-[10px] min-h-[120px] resize-y"
          />
          <p className="text-[9px] text-muted-foreground">
            JSON object to override Recharts component properties. Supports grid, xAxis, yAxis, tooltip, legend, line, bar, area, pie keys.
          </p>
        </div>
      </div>
    </div>
  );
}

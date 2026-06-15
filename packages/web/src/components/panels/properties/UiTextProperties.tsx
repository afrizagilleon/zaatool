import { useFlowStore } from '../../../store/flowStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Label } from '../../ui/label';

export function UiTextProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);
  
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const currentFormat = node.data.format || 'auto';

  const handleFormatChange = (val: string) => {
    updateNodeData(nodeId, { format: val });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Render Format</Label>
        <Select value={currentFormat} onValueChange={handleFormatChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto" className="text-xs">Auto Detect</SelectItem>
            <SelectItem value="markdown" className="text-xs">Markdown / Markup</SelectItem>
            <SelectItem value="json" className="text-xs">JSON Code Block</SelectItem>
            <SelectItem value="text" className="text-xs">Plain Text (TXT)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-xs text-muted-foreground italic">
        Configure how the incoming 'value' should be formatted and rendered in the display preview.
      </div>
    </div>
  );
}

import { useFlowStore } from '../../../store/flowStore';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';

export function UiImageProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);
  
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const handleSrcChange = (val: string) => {
    updateNodeData(nodeId, {
      inputs: {
        ...node.data.inputs,
        src: val
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Image Source (URL or Path)</Label>
        <Input 
          placeholder="https://example.com/image.png" 
          value={(node.data.inputs?.src as string) || ''} 
          onChange={(e) => handleSrcChange(e.target.value)} 
        />
      </div>
      <div className="text-xs text-muted-foreground italic">
        You can provide a static image source URL here, or connect it dynamically via the 'src' input handle.
      </div>
    </div>
  );
}

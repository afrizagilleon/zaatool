import { useFlowStore } from '../../../store/flowStore';
import { useStorage } from '../../../hooks/useStorage';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Label } from '../../ui/label';
import { ScrollArea } from '../../ui/scroll-area';

export function FileProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);
  const { files, isLoading } = useStorage();
  
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const currentFile = node.data.inputs?.file;

  const handleFileChange = (val: string) => {
    updateNodeData(nodeId, {
      inputs: {
        ...node.data.inputs,
        file: val
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Select File from Storage</Label>
        <Select value={currentFile as string || ""} onValueChange={handleFileChange}>
          <SelectTrigger>
            <SelectValue placeholder={isLoading ? "Loading files..." : "Select a file"} />
          </SelectTrigger>
          <SelectContent>
            <ScrollArea className="h-[200px]">
              {files.filter(f => f.mime_type !== 'folder').map(f => (
                <SelectItem key={f.path} value={f.path}>
                  {f.name}
                </SelectItem>
              ))}
              {files.filter(f => f.mime_type !== 'folder').length === 0 && !isLoading && (
                <div className="p-2 text-xs text-muted-foreground text-center">No files found</div>
              )}
            </ScrollArea>
          </SelectContent>
        </Select>
      </div>
      <div className="text-xs text-muted-foreground italic">
        Select a file from your project storage to be used as input data.
      </div>
    </div>
  );
}

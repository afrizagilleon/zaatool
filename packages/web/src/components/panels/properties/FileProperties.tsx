import { useState } from 'react';
import { useFlowStore } from '../../../store/flowStore';
import { useStorage } from '../../../hooks/useStorage';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Label } from '../../ui/label';
import { ScrollArea } from '../../ui/scroll-area';
import { Switch } from '../../ui/switch';
import { Input } from '../../ui/input';

export function FileProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);
  const { files, isLoading } = useStorage();
  const [searchTerm, setSearchTerm] = useState('');

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const currentFile = node.data.inputs?.file;

  const nodeConfig = node.data.config || {};
  const changeable = nodeConfig.changeable !== false;
  const fileType = (nodeConfig.fileType as string) || 'all';
  const folder = (nodeConfig.folder as string) || '';

  const updateConfig = (newConfig: Record<string, any>) => {
    updateNodeData(nodeId, {
      config: {
        ...nodeConfig,
        ...newConfig
      }
    });
  };

  const handleFileChange = (val: string) => {
    updateNodeData(nodeId, {
      inputs: {
        ...node.data.inputs,
        file: val === '__none__' ? null : val
      }
    });
  };

  const nonFolderFiles = files.filter(f => f.mime_type !== 'folder');
  const filteredFiles = searchTerm
    ? nonFolderFiles.filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : nonFolderFiles;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Source File Selection</span>
        <div className="space-y-2">
          <Label>Select File from Storage</Label>
          <Select value={(currentFile as string) || ''} onValueChange={handleFileChange}>
            <SelectTrigger>
              <SelectValue placeholder={isLoading ? 'Loading files...' : 'Select a file'} />
            </SelectTrigger>
            <SelectContent>
              <div className="px-2 py-1.5 sticky top-0 bg-popover z-10" onKeyDown={(e) => e.stopPropagation()}>
                <Input
                  placeholder="Search files..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <ScrollArea className="h-[200px]">
                <SelectItem value="__none__">— None —</SelectItem>
                {filteredFiles.map(f => (
                  <SelectItem key={f.path} value={f.path}>
                    {f.name}
                  </SelectItem>
                ))}
                {filteredFiles.length === 0 && !isLoading && (
                  <div className="p-2 text-xs text-muted-foreground text-center">
                    {searchTerm ? 'No matching files' : 'No files found'}
                  </div>
                )}
              </ScrollArea>
            </SelectContent>
          </Select>
        </div>
        <div className="text-xs text-muted-foreground italic">
          Select a file from your project storage to be used as input data.
        </div>
      </div>

      <div className="space-y-4 pt-4 border-t border-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Dashboard Settings</span>

        <div className="flex items-center justify-between py-1">
          <Label htmlFor="file-changeable" className="text-xs">Changeable in Dashboard</Label>
          <Switch
            id="file-changeable"
            checked={changeable}
            onCheckedChange={(checked) => updateConfig({ changeable: checked })}
          />
        </div>
        <p className="text-[10px] text-muted-foreground -mt-2">
          Allow users to upload and change this file directly from the published dashboard.
        </p>

        {changeable && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Allowed File Types</Label>
              <Select
                value={fileType}
                onValueChange={(v) => updateConfig({ fileType: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Files (*.*)</SelectItem>
                  <SelectItem value="images">Images Only (image/*)</SelectItem>
                  <SelectItem value="excel_csv">Excel/CSV (.csv, .xls, .xlsx)</SelectItem>
                  <SelectItem value="videos">Videos Only (video/*)</SelectItem>
                  <SelectItem value="documents">Documents (.pdf, .doc, .txt, .md)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Destination Folder</Label>
              <Input
                placeholder="e.g. uploads/images"
                value={folder}
                onChange={(e) => updateConfig({ folder: e.target.value })}
                className="h-8 text-xs"
              />
              <p className="text-[9px] text-muted-foreground">
                Saves uploaded files to this specific subfolder in project storage.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

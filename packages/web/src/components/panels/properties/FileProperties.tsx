import { useState } from 'react';
import { useFlowStore } from '../../../store/flowStore';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { FileExplorerPickerDialog } from '../../resources/FileExplorerPickerDialog';
import { FileText, Folder, X } from '@phosphor-icons/react';
import { cn } from '../../../lib/utils';

export function FileProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const currentFile = (node.data.inputs?.file as string) || '';

  const nodeConfig = node.data.config || {};
  const changeable = nodeConfig.changeable !== false;
  const rawFileType = (nodeConfig.fileType as string) || '';
  const fileType = rawFileType === 'all' ? '' : rawFileType;
  const folder = (nodeConfig.folder as string) || '';

  const updateConfig = (newConfig: Record<string, any>) => {
    updateNodeData(nodeId, {
      config: {
        ...nodeConfig,
        ...newConfig
      }
    });
  };

  const setFile = (path: string | null) => {
    updateNodeData(nodeId, {
      inputs: {
        ...node.data.inputs,
        file: path
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Source File Selection</span>
        <div className="space-y-2">
          <Label>Select File from Storage</Label>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              onClick={() => setIsFilePickerOpen(true)}
              className="flex-1 h-9 justify-start text-xs font-normal gap-2 min-w-0"
            >
              <FileText size={14} className="text-muted-foreground shrink-0" />
              <span className={cn('truncate', !currentFile && 'text-muted-foreground italic')}>
                {currentFile || 'No file selected'}
              </span>
            </Button>
            {currentFile && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => setFile(null)}
              >
                <X size={14} />
              </Button>
            )}
          </div>
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
              <Input
                placeholder="e.g. pdf, docx or image/*"
                value={fileType}
                onChange={(e) => updateConfig({ fileType: e.target.value })}
                className="h-8 text-xs"
              />
              <p className="text-[9px] text-muted-foreground">
                Comma-separated extensions or MIME patterns (e.g. <code>pdf, docx</code> or <code>image/*</code>).
                Leave empty to allow any file.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Destination Folder</Label>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  onClick={() => setIsFolderPickerOpen(true)}
                  className="flex-1 h-9 justify-start text-xs font-normal gap-2 min-w-0"
                >
                  <Folder size={14} className="text-muted-foreground shrink-0" />
                  <span className={cn('truncate', !folder && 'text-muted-foreground italic')}>
                    {folder || 'storage (root)'}
                  </span>
                </Button>
                {folder && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => updateConfig({ folder: '' })}
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground">
                Saves uploaded files to this specific subfolder in project storage.
              </p>
            </div>
          </>
        )}
      </div>

      <FileExplorerPickerDialog
        open={isFilePickerOpen}
        onOpenChange={setIsFilePickerOpen}
        mode="file"
        initialPath={currentFile}
        onSelect={setFile}
      />

      <FileExplorerPickerDialog
        open={isFolderPickerOpen}
        onOpenChange={setIsFolderPickerOpen}
        mode="folder"
        initialPath={folder}
        onSelect={(path) => updateConfig({ folder: path })}
      />
    </div>
  );
}

import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { File as FileIcon, UploadSimple, Eye, EyeSlash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/uiStore';
import { useFileExists } from '../../hooks/useFileExists';
import type { FlowNodeData } from '../../store/flowStore';

type FileNodeProps = NodeProps<Node<FlowNodeData, 'file'>>;

export function FileNode({ id, data, selected }: FileNodeProps) {
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';
  const updateNodeInternals = useUpdateNodeInternals();
  const [showPanel, setShowPanel] = useState(true);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isVertical, updateNodeInternals]);

  const selectedFile = data.inputs?.file;
  const fileExists = useFileExists(selectedFile as string | undefined);

  const handleClass = "!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none";

  const renderFilePreview = () => {
    if (!showPanel) return null;
    return (
      <div className={cn(
        "absolute bg-card text-card-foreground shadow-lg border border-border p-4 rounded-md w-64 z-10",
        isVertical ? "top-0 left-full ml-4" : "top-full mt-4 left-0"
      )}>
        <div className="text-xs font-semibold mb-3 pb-2 border-b border-border flex justify-between items-center">
          <span>{data.label || 'File Input'}</span>
          {!fileExists && (
            <span className="text-[9px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
              Missing File
            </span>
          )}
        </div>

        <div className={cn(
          "border-2 border-dashed rounded-md p-6 flex flex-col items-center justify-center gap-2 hover:bg-muted/50 transition-colors cursor-pointer",
          fileExists ? "border-border" : "border-destructive/50 bg-destructive/5"
        )}>
          {selectedFile ? (
            <>
              <FileIcon size={24} className={fileExists ? "text-primary" : "text-destructive"} weight="duotone" />
              <span className={cn("text-xs font-medium text-center truncate w-full", fileExists ? "text-foreground" : "text-destructive")} title={String(selectedFile)}>
                {String(selectedFile).split('/').pop()}
              </span>
              {!fileExists && (
                <span className="text-[10px] text-destructive text-center mt-1 font-medium">
                  File missing in storage!
                </span>
              )}
            </>
          ) : (
            <>
              <UploadSimple size={24} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground text-center">No file selected</span>
            </>
          )}
        </div>
      </div>
    );
  };

  if (isVertical) {
    return (
      <div
        id={`node-${id}`}
        className={cn(
          'min-w-48 border bg-node-bg shadow-sm transition-all relative',
          selected ? 'border-primary ring-2 ring-primary/20 shadow-md' : 'border-node-border hover:shadow-md hover:border-border'
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
          <div className="flex items-center justify-center w-5 h-5 bg-orange-500/10 text-orange-500">
            <FileIcon size={14} weight="duotone" />
          </div>
          <span className="text-[11px] font-semibold text-foreground truncate flex-1">
            {data.label || 'File Input'}
          </span>
          <button 
            onClick={() => setShowPanel(!showPanel)} 
            className="text-muted-foreground hover:text-foreground transition-colors outline-none"
            title={showPanel ? "Hide Panel" : "Show Panel"}
          >
            {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
          </button>
          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-orange-500/10 text-orange-500">DATA</span>
        </div>

        <Handle type="target" position={Position.Top} id="file" style={{ left: '50%' }} className={handleClass} />

        <div className="flex justify-center px-3 pt-3 pb-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground">file</span>
            <span className="text-[7px] font-medium text-muted-foreground/50 uppercase">STRING</span>
          </div>
        </div>

        <Handle type="source" position={Position.Bottom} id="file" style={{ left: '50%' }} className={handleClass} />

        <div className="flex justify-center px-3 pt-2 pb-3">
          <div className="flex flex-col items-center">
            <span className="text-[7px] font-medium text-muted-foreground/50 uppercase tracking-wide">STRING</span>
            <span className="text-[9px] text-muted-foreground">file</span>
          </div>
        </div>

        {renderFilePreview()}
      </div>
    );
  }

  // Horizontal layout
  return (
    <div
      id={`node-${id}`}
      className={cn(
        'w-48 border bg-node-bg shadow-sm transition-all relative',
        selected ? 'border-primary ring-2 ring-primary/20 shadow-md' : 'border-node-border hover:shadow-md hover:border-border'
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
        <div className="flex items-center justify-center w-5 h-5 bg-orange-500/10 text-orange-500">
          <FileIcon size={14} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'File Input'}
        </span>
        <button 
          onClick={() => setShowPanel(!showPanel)} 
          className="text-muted-foreground hover:text-foreground transition-colors outline-none"
          title={showPanel ? "Hide Panel" : "Show Panel"}
        >
          {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
        </button>
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-orange-500/10 text-orange-500">DATA</span>
      </div>

      <div className="px-3 py-3">
        <div className="flex justify-between gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="relative flex items-center gap-1.5 h-4">
              <Handle type="target" position={Position.Left} id="file" className={cn(handleClass, "!left-[-12px]")} style={{ left: -15 }} />
              <span className="text-[10px] text-muted-foreground">file</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 items-end min-w-0 w-full">
            <div className="relative flex items-center justify-end gap-1.5 h-4 w-full">
              <span className="text-[10px] text-muted-foreground">file</span>
              <Handle type="source" position={Position.Right} id="file" className={cn(handleClass, "!right-[-12px]")} style={{ right: -15 }} />
            </div>
          </div>
        </div>
      </div>

      {renderFilePreview()}
    </div>
  );
}

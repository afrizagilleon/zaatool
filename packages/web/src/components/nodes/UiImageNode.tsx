import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { Image as ImageIcon, Eye, EyeSlash } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { API_BASE_URL } from '../../lib/api';
import { useUiStore } from '../../store/uiStore';
import { useFlowStore } from '../../store/flowStore';
import type { FlowNodeData } from '../../store/flowStore';

type UiImageNodeProps = NodeProps<Node<FlowNodeData, 'ui:image'>>;

export function UiImageNode({ id, data, selected }: UiImageNodeProps) {
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNodeData = useFlowStore((s) => s.updateNodeData);

  const showPanel = data.showPanel !== false;
  const setShowPanel = (show: boolean) => {
    updateNodeData(id, { showPanel: show });
  };

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isVertical, updateNodeInternals]);

  const handleClass = "!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none";

  const renderImagePreview = () => {
    if (!showPanel) return null;
    const rawSrc = data.inputs?.src;
    let srcUrl = '';

    if (typeof rawSrc === 'string') {
      srcUrl = rawSrc;
    } else if (rawSrc && typeof rawSrc === 'object') {
      srcUrl = (rawSrc as any).url || (rawSrc as any).path || (rawSrc as any).content || '';
    }
    
    if (srcUrl && !srcUrl.startsWith('http') && !srcUrl.startsWith('data:')) {
      // Resolve against local storage API if it's a relative path/filename
      srcUrl = `${API_BASE_URL}/storage/${srcUrl}`;
    }

    return (
      <div className={cn(
        "absolute bg-card text-card-foreground shadow-lg border border-border p-2 rounded-md w-64 h-48 flex items-center justify-center overflow-hidden z-10",
        isVertical ? "top-0 left-full ml-4" : "top-full mt-4 left-0"
      )}>
        {srcUrl ? (
          <img src={srcUrl} alt="Preview" className="max-w-full max-h-full object-contain rounded" />
        ) : (
          <div className="text-xs text-muted-foreground flex flex-col items-center gap-2">
            <ImageIcon size={32} weight="duotone" className="opacity-50" />
            <span>No Image Source</span>
          </div>
        )}
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
        <Handle type="target" position={Position.Top} id="src" style={{ left: '50%' }} className={handleClass} />

        <div className="flex justify-center px-3 pt-3 pb-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground">src</span>
            <span className="text-[7px] font-medium text-muted-foreground/50 uppercase">STRING</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-y border-border/50 bg-muted/20">
          <div className="flex items-center justify-center w-5 h-5 bg-purple-500/10 text-purple-500">
            <ImageIcon size={14} weight="duotone" />
          </div>
          <span className="text-[11px] font-semibold text-foreground truncate flex-1">
            {data.label || 'Image'}
          </span>
          <button 
            onClick={() => setShowPanel(!showPanel)} 
            className="text-muted-foreground hover:text-foreground transition-colors outline-none"
            title={showPanel ? "Hide Panel" : "Show Panel"}
          >
            {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
          </button>
          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-purple-500/10 text-purple-500">UI</span>
        </div>

        <div className="h-2"></div>

        {renderImagePreview()}
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
        <div className="flex items-center justify-center w-5 h-5 bg-purple-500/10 text-purple-500">
          <ImageIcon size={14} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'Image'}
        </span>
        <button 
          onClick={() => setShowPanel(!showPanel)} 
          className="text-muted-foreground hover:text-foreground transition-colors outline-none"
          title={showPanel ? "Hide Panel" : "Show Panel"}
        >
          {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
        </button>
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-purple-500/10 text-purple-500">UI</span>
      </div>

      <div className="px-3 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="relative flex items-center gap-1.5 h-4">
            <Handle type="target" position={Position.Left} id="src" className={cn(handleClass, "!left-[-12px]")} style={{ left: -15 }} />
            <span className="text-[10px] text-muted-foreground">src</span>
          </div>
        </div>
      </div>

      {renderImagePreview()}
    </div>
  );
}

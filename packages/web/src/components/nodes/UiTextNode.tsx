import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { TextAa, Eye, EyeSlash } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/uiStore';
import { useFlowStore } from '../../store/flowStore';
import type { FlowNodeData } from '../../store/flowStore';
import ReactMarkdown from 'react-markdown';

type UiTextNodeProps = NodeProps<Node<FlowNodeData, 'ui:text'>>;

export function UiTextNode({ id, data, selected }: UiTextNodeProps) {
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

  const renderTextPreview = () => {
    if (!showPanel) return null;
    const rawVal = data.inputs?.value;
    const format = data.format || 'auto';

    const renderContent = () => {
      if (rawVal === undefined || rawVal === null) {
        return (
          <div className="text-xs text-muted-foreground italic">
            Text preview will appear here when connected to data...
          </div>
        );
      }

      const textStr = typeof rawVal === 'object' ? JSON.stringify(rawVal, null, 2) : String(rawVal).replace(/\\n/g, '\n');

      // Determine target format
      let activeFormat = format;
      if (format === 'auto') {
        if (typeof rawVal === 'object') {
          activeFormat = 'json';
        } else {
          try {
            JSON.parse(textStr);
            activeFormat = 'json';
          } catch {
            const isMd = /[#*_`\[\]\-\n]/.test(textStr);
            activeFormat = isMd ? 'markdown' : 'text';
          }
        }
      }

      if (activeFormat === 'json') {
        let prettyJson = textStr;
        try {
          if (typeof rawVal !== 'object') {
            prettyJson = JSON.stringify(JSON.parse(textStr), null, 2);
          }
        } catch { }
        return (
          <pre className="text-[11px] font-mono bg-muted/50 p-2 rounded border border-border overflow-x-auto whitespace-pre leading-relaxed max-w-full text-foreground">
            {prettyJson}
          </pre>
        );
      }

      if (activeFormat === 'markdown') {
        return (
          <div className="prose prose-xs max-w-none text-xs leading-relaxed text-foreground break-words dark:prose-invert">
            <ReactMarkdown>{textStr}</ReactMarkdown>
          </div>
        );
      }

      // Default to plain text
      return (
        <div className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground bg-muted/10 p-2 rounded border border-border/50 max-w-full break-words">
          {textStr}
        </div>
      );
    };

    return (
      <div className={cn(
        "nodrag nowheel nopan absolute bg-card text-card-foreground shadow-lg border border-border p-4 rounded-md w-80 min-h-[100px] max-h-[350px] overflow-y-auto z-10",
        isVertical ? "top-0 left-full ml-4" : "top-full mt-4 left-0"
      )}>
        <div className="text-xs font-semibold mb-2 pb-2 border-b border-border flex justify-between items-center">
          <span>{data.label || 'Text Display'}</span>
          <span className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider bg-muted px-1.5 py-0.5 rounded">
            {format}
          </span>
        </div>
        {renderContent()}
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
        <Handle type="target" position={Position.Top} id="value" style={{ left: '50%' }} className={handleClass} />

        <div className="flex justify-center px-3 pt-3 pb-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground">value</span>
            <span className="text-[7px] font-medium text-muted-foreground/50 uppercase">STRING</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-y border-border/50 bg-muted/20">
          <div className="flex items-center justify-center w-5 h-5 bg-green-500/10 text-green-500">
            <TextAa size={14} weight="duotone" />
          </div>
          <span className="text-[11px] font-semibold text-foreground truncate flex-1">
            {data.label || 'Text Display'}
          </span>
          <button
            onClick={() => setShowPanel(!showPanel)}
            className="text-muted-foreground hover:text-foreground transition-colors outline-none"
            title={showPanel ? "Hide Panel" : "Show Panel"}
          >
            {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
          </button>
          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-green-500/10 text-green-500">UI</span>
        </div>

        {/* No output handles for purely display node */}
        <div className="h-2"></div>

        {renderTextPreview()}
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
        <div className="flex items-center justify-center w-5 h-5 bg-green-500/10 text-green-500">
          <TextAa size={14} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'Text Display'}
        </span>
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="text-muted-foreground hover:text-foreground transition-colors outline-none"
          title={showPanel ? "Hide Panel" : "Show Panel"}
        >
          {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
        </button>
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-green-500/10 text-green-500">UI</span>
      </div>

      <div className="px-3 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="relative flex items-center gap-1.5 h-4">
            <Handle type="target" position={Position.Left} id="value" className={cn(handleClass, "!left-[-12px]")} style={{ left: -15 }} />
            <span className="text-[10px] text-muted-foreground truncate">value</span>
          </div>
        </div>
      </div>

      {renderTextPreview()}
    </div>
  );
}

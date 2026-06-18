import { useCallback, useEffect } from 'react';
import { X, Code, Trash } from '@phosphor-icons/react';
import { useFlowStore } from '../../store/flowStore';
import { useUiStore } from '../../store/uiStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

import { UiInputProperties } from './properties/UiInputProperties';
import { UiTableProperties } from './properties/UiTableProperties';
import { UiChartProperties } from './properties/UiChartProperties';
import { UiTextProperties } from './properties/UiTextProperties';
import { UiImageProperties } from './properties/UiImageProperties';
import { FileProperties } from './properties/FileProperties';
import { TriggerCronProperties } from './properties/TriggerCronProperties';
import { CodeNodeProperties } from './CodeNodeProperties';
import { getNodeIconAndClass } from '../../lib/nodeIconMap';

export function PropertiesPanel() {
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const updateSchemaField = useFlowStore((s) => s.updateSchemaField);
  const removeNode = useFlowStore((s) => s.removeNode);
  const setCodePanelOpen = useUiStore((s) => s.setCodePanelOpen);
  const openCodeEditor = useUiStore((s) => s.openCodeEditor);

  const activeNode = nodes.find((n) => n.id === activeNodeId);

  useEffect(() => {}, [activeNodeId]);

  const handleClose = useCallback(() => {
    setCodePanelOpen(false);
  }, [setCodePanelOpen]);

  if (!activeNode) {
    return (
      <aside
        id="properties-panel"
        className="flex flex-col w-72 border-l border-border bg-background shrink-0 animate-slide-in-right"
      >
        <div className="flex items-center justify-between px-3 h-10 border-b border-border shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Properties
          </span>
          <Button
            id="properties-panel-close"
            onClick={handleClose}
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-muted-foreground"
          >
            <X size={12} />
          </Button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
          <div className="w-10 h-10 bg-muted/50 flex items-center justify-center">
            <Code size={18} className="text-muted-foreground/40" />
          </div>
          <p className="text-xs text-muted-foreground/60 leading-relaxed">
            Select a node on the canvas to edit its properties
          </p>
        </div>
      </aside>
    );
  }

  const nodeType = activeNode.type ?? 'code';
  const isCodeNode = nodeType === 'code';
  const runtime = activeNode.data.runtime ?? 'node';

  const { Icon: NodeIcon, accent: accentClass } = getNodeIconAndClass(nodeType, runtime as string);

  const renderSpecificProperties = () => {
    switch (nodeType) {
      case 'ui:input':    return <UiInputProperties nodeId={activeNode.id} />;
      case 'ui:table':    return <UiTableProperties nodeId={activeNode.id} />;
      case 'ui:chart':    return <UiChartProperties nodeId={activeNode.id} />;
      case 'ui:text':     return <UiTextProperties nodeId={activeNode.id} />;
      case 'ui:image':    return <UiImageProperties nodeId={activeNode.id} />;
      case 'file':        return <FileProperties nodeId={activeNode.id} />;
      case 'trigger:cron': return <TriggerCronProperties nodeId={activeNode.id} />;
      case 'trigger:start': return (
        <div className="text-xs text-muted-foreground italic bg-muted/20 p-3 rounded-lg border border-border/60">
          Manual execution trigger. Click the green "Run Flow" button directly on the canvas node to execute the downstream workflow.
        </div>
      );
      default:
        return (
          <CodeNodeProperties
            activeNode={activeNode}
            isCodeNode={isCodeNode}
            runtime={runtime as string}
            updateNodeData={updateNodeData}
            updateSchemaField={updateSchemaField}
            openCodeEditor={openCodeEditor}
          />
        );
    }
  };

  return (
    <aside
      id="properties-panel"
      className="flex flex-col w-72 border-l border-border bg-background shrink-0 animate-slide-in-right"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border shrink-0">
        <NodeIcon size={14} weight="duotone" className={accentClass} />
        <span className="text-xs font-semibold text-foreground truncate flex-1">
          {activeNode.data.label || nodeType}
        </span>
        <Button
          id="properties-panel-delete-node"
          onClick={() => removeNode(activeNode.id)}
          variant="ghost"
          size="icon"
          className="w-6 h-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Delete node"
        >
          <Trash size={12} />
        </Button>
        <Button
          id="properties-panel-close-btn"
          onClick={handleClose}
          variant="ghost"
          size="icon"
          className="w-6 h-6 text-muted-foreground"
        >
          <X size={12} />
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Label */}
        <div className="space-y-1.5">
          <label
            htmlFor="node-label-input"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Label
          </label>
          <Input
            id="node-label-input"
            value={activeNode.data.label || ''}
            onChange={(e) => updateNodeData(activeNode.id, { label: e.target.value })}
            className="h-8 text-xs"
            placeholder="Node label"
          />
        </div>

        {['ui:input', 'ui:text', 'ui:table', 'ui:image', 'file'].includes(nodeType) && (
          <div className="flex items-center justify-between p-2.5 bg-muted/30 border border-border/60 rounded-lg">
            <span className="text-xs font-semibold text-foreground/80">Show in Dashboard</span>
            <input
              type="checkbox"
              id="node-show-in-dashboard"
              checked={activeNode.data.showInDashboard !== false}
              onChange={(e) => updateNodeData(activeNode.id, { showInDashboard: e.target.checked })}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
            />
          </div>
        )}

        {/* Dynamic Properties based on Node Type */}
        {renderSpecificProperties()}
      </div>

    </aside>
  );
}

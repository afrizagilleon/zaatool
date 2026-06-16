import { useCallback, useState } from 'react';
import {
  X,
  Code,
  BracketsCurly,
  GitBranch,
  ArrowsClockwise,
  Plus,
  Trash,
  ArrowsOutSimple,
  AppWindow,
  Table as TableIcon,
  TextAa,
  Image as ImageIcon,
  File as FileIcon
} from '@phosphor-icons/react';
import { useFlowStore } from '../../store/flowStore';
import { useUiStore } from '../../store/uiStore';
import { type SchemaField, SCHEMA_FIELD_TYPES } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Textarea } from '../ui/textarea';
import { CodeEditorDialog } from './CodeEditorDialog';
import { UiInputProperties } from './properties/UiInputProperties';
import { UiTableProperties } from './properties/UiTableProperties';
import { UiTextProperties } from './properties/UiTextProperties';
import { UiImageProperties } from './properties/UiImageProperties';
import { FileProperties } from './properties/FileProperties';
import { TriggerCronProperties } from './properties/TriggerCronProperties';

function SchemaEditor({
  label,
  fields,
  onChange,
  id,
  onUpdateField,
}: {
  label: string;
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
  id: string;
  onUpdateField: (index: number, patch: Partial<SchemaField>) => void;
}) {
  const addField = () => {
    const name = `field${fields.length + 1}`;
    onChange([...fields, { name, type: 'string' }]);
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, patch: Partial<SchemaField>) => {
    onUpdateField(index, patch);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <Button
          id={`${id}-add-btn`}
          onClick={addField}
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2"
        >
          <Plus size={10} weight="bold" className="mr-1" />
          Add
        </Button>
      </div>

      {fields.length === 0 && (
        <div className="text-[10px] text-muted-foreground/40 italic px-1">
          No fields defined
        </div>
      )}

      <div className="space-y-1.5">
        {fields.map((field, index) => (
          <div key={index} className="flex items-center gap-1.5 group">
            <Input
              id={`${id}-name-${index}`}
              value={field.name}
              onChange={(e) => updateField(index, { name: e.target.value.replace(/\s+/g, '_') })}
              className="flex-1 h-7 text-xs"
              placeholder="name"
            />
            <Select
              value={field.type}
              onValueChange={(val) => updateField(index, { type: val as SchemaField['type'] })}
            >
              <SelectTrigger id={`${id}-type-${index}`} className="w-[85px] h-7 text-[10px] font-medium">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {SCHEMA_FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-[10px]">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              id={`${id}-del-${index}`}
              onClick={() => removeField(index)}
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash size={12} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PropertiesPanel() {
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const updateSchemaField = useFlowStore((s) => s.updateSchemaField);
  const removeNode = useFlowStore((s) => s.removeNode);
  const setCodePanelOpen = useUiStore((s) => s.setCodePanelOpen);

  const [editorOpen, setEditorOpen] = useState(false);

  const activeNode = nodes.find((n) => n.id === activeNodeId);

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

  const getNodeIconAndClass = () => {
    switch (nodeType) {
      case 'if': return { Icon: GitBranch, accent: 'text-node-if' };
      case 'loop': return { Icon: ArrowsClockwise, accent: 'text-node-loop' };
      case 'ui:input': return { Icon: AppWindow, accent: 'text-primary' };
      case 'ui:table': return { Icon: TableIcon, accent: 'text-blue-500' };
      case 'ui:text': return { Icon: TextAa, accent: 'text-green-500' };
      case 'ui:image': return { Icon: ImageIcon, accent: 'text-purple-500' };
      case 'file': return { Icon: FileIcon, accent: 'text-orange-500' };
      default: return { Icon: runtime === 'python' ? BracketsCurly : Code, accent: runtime === 'python' ? 'text-node-code-py' : 'text-node-code' };
    }
  };

  const { Icon: NodeIcon, accent: accentClass } = getNodeIconAndClass();

  const renderSpecificProperties = () => {
    switch (nodeType) {
      case 'ui:input': return <UiInputProperties nodeId={activeNode.id} />;
      case 'ui:table': return <UiTableProperties nodeId={activeNode.id} />;
      case 'ui:text': return <UiTextProperties nodeId={activeNode.id} />;
      case 'ui:image': return <UiImageProperties nodeId={activeNode.id} />;
      case 'file': return <FileProperties nodeId={activeNode.id} />;
      case 'trigger:cron': return <TriggerCronProperties nodeId={activeNode.id} />;
      case 'trigger:start': return <div className="text-xs text-muted-foreground italic bg-muted/20 p-3 rounded-lg border border-border/60">Manual execution trigger. Click the green "Run Flow" button directly on the canvas node to execute the downstream workflow.</div>;
      default:
        // Default to code/if/loop properties
        return (
          <>
            {isCodeNode && (
              <div className="space-y-1.5">
                <label
                  htmlFor="node-runtime-select"
                  className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Runtime
                </label>
                <Select
                  value={runtime}
                  onValueChange={(val) =>
                    updateNodeData(activeNode.id, {
                      runtime: val as 'node' | 'python',
                    })
                  }
                >
                  <SelectTrigger id="node-runtime-select" className="h-8 text-xs">
                    <SelectValue placeholder="Select runtime" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="node" className="text-xs">JavaScript (Node.js)</SelectItem>
                    <SelectItem value="python" className="text-xs">Python</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {(isCodeNode || nodeType === 'if') && (
              <div className="space-y-1.5 flex flex-col h-[200px]">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="node-code-textarea"
                    className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    Code
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => setEditorOpen(true)}
                  >
                    <ArrowsOutSimple size={12} className="mr-1" />
                    Focus Editor
                  </Button>
                </div>
                <Textarea
                  id="node-code-textarea"
                  value={activeNode.data.code || ''}
                  onChange={(e) => updateNodeData(activeNode.id, { code: e.target.value })}
                  placeholder={
                    runtime === 'python'
                      ? '# Write your Python code here'
                      : '// Write your JavaScript code here'
                  }
                  className="flex-1 text-[11px] leading-[18px] font-mono resize-none focus-visible:ring-1"
                  spellCheck={false}
                />
              </div>
            )}

            <SchemaEditor
              id="inputs-schema"
              label="Inputs Schema"
              fields={activeNode.data.inputsSchema || []}
              onChange={(fields) => updateNodeData(activeNode.id, { inputsSchema: fields })}
              onUpdateField={(index, patch) => updateSchemaField(activeNode.id, 'inputsSchema', index, patch)}
            />

            <SchemaEditor
              id="outputs-schema"
              label="Outputs Schema"
              fields={activeNode.data.outputsSchema || []}
              onChange={(fields) => updateNodeData(activeNode.id, { outputsSchema: fields })}
              onUpdateField={(index, patch) => updateSchemaField(activeNode.id, 'outputsSchema', index, patch)}
            />
          </>
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

        {/* Dynamic Properties based on Node Type */}
        {renderSpecificProperties()}
      </div>

      <CodeEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        nodeId={activeNode.id}
      />
    </aside>
  );
}

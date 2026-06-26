import { useState } from 'react';
import { ArrowsOutSimple } from '@phosphor-icons/react';
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
import { SchemaEditor } from './SchemaEditor';

interface CodeNodePropertiesProps {
  activeNode: any;
  isCodeNode: boolean;
  runtime: string;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  updateSchemaField: (nodeId: string, schema: 'inputsSchema' | 'outputsSchema', index: number, patch: any) => void;
  openCodeEditor: (id: string) => void;
}

export function CodeNodeProperties({
  activeNode,
  isCodeNode,
  runtime,
  updateNodeData,
  updateSchemaField,
  openCodeEditor,
}: CodeNodePropertiesProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const nodeType = activeNode.type ?? 'code';

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

      {isCodeNode && runtime === 'python' && (
        <div className="space-y-1.5">
          <label
            htmlFor="node-requirements-input"
            className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Python Packages (pip)
          </label>
          <Input
            id="node-requirements-input"
            value={activeNode.data.config?.requirements as string || ''}
            onChange={(e) => {
              const currentConfig = activeNode.data.config || {};
              updateNodeData(activeNode.id, {
                config: {
                  ...currentConfig,
                  requirements: e.target.value,
                }
              });
            }}
            placeholder="e.g. requests, beautifulsoup4"
            className="h-8 text-xs font-mono"
          />
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
              onClick={() => openCodeEditor(activeNode.id)}
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

      <div className="border-t border-border pt-4 mt-4">
        <button
          type="button"
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
          className="flex items-center justify-between w-full text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors outline-none"
        >
          <span>Advanced Settings</span>
          <span className="text-xs">{isAdvancedOpen ? '−' : '+'}</span>
        </button>

        {isAdvancedOpen && (
          <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="space-y-1.5">
              <label
                htmlFor="node-timeout-input"
                className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
              >
                Execution Timeout (ms)
              </label>
              <Input
                id="node-timeout-input"
                type="number"
                value={activeNode.data.config?.timeout !== undefined ? String(activeNode.data.config.timeout) : '5000'}
                onChange={(e) => {
                  const currentConfig = activeNode.data.config || {};
                  const val = e.target.value === '' ? undefined : Number(e.target.value);
                  updateNodeData(activeNode.id, {
                    config: {
                      ...currentConfig,
                      timeout: val,
                    }
                  });
                }}
                placeholder="e.g. 5000"
                className="h-8 text-xs font-mono"
              />
              <p className="text-[9px] text-muted-foreground leading-normal">
                Timeout limit in milliseconds. Default is 5000ms (5 seconds).
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

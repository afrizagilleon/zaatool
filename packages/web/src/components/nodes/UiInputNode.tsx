import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { AppWindow, Eye, EyeSlash, Play } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/uiStore';
import { useFlowStore } from '../../store/flowStore';
import { useEngineStore } from '../../store/engineStore';
import type { FlowNodeData } from '../../store/flowStore';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { Button } from '../ui/button';

type UiInputNodeProps = NodeProps<Node<FlowNodeData, 'ui:input'>>;

export function UiInputNode({ id, data, selected }: UiInputNodeProps) {
  const uiSchema = data.uiSchema || { fields: [], layout: { columns: 1 } };
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';
  const updateNodeInternals = useUpdateNodeInternals();
  const [showPanel, setShowPanel] = useState(true);

  const runFlow = useEngineStore((s) => s.runFlow);
  const getGraphJson = useFlowStore((s) => s.getGraphJson);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);

  const [formValues, setFormValues] = useState<Record<string, any>>({});

  // Initialize formValues from data.values
  useEffect(() => {
    if (data.values) {
      setFormValues(data.values);
    }
  }, [data.values]);

  const handleFieldChange = (fieldId: string, value: any, triggerImmediately = false) => {
    const nextValues = { ...formValues, [fieldId]: value };
    setFormValues(nextValues);
    updateNodeData(id, { values: nextValues });

    if (uiSchema.layout?.triggerOn === 'change' || triggerImmediately) {
      setTimeout(() => {
        runFlow(getGraphJson());
      }, 0);
    }
  };

  const handleBlur = (_fieldId: string) => {
    updateNodeData(id, { values: formValues });
    if (uiSchema.layout?.triggerOn === 'change') {
      setTimeout(() => {
        runFlow(getGraphJson());
      }, 0);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateNodeData(id, { values: formValues });
    setTimeout(() => {
      runFlow(getGraphJson());
    }, 0);
  };

  const getFieldOptions = (field: any) => {
    const dynamicOpts = data.inputs?.[`options_${field.id}`];
    if (Array.isArray(dynamicOpts)) {
      return dynamicOpts.map(opt => {
        if (typeof opt === 'string') return { label: opt, value: opt };
        if (opt && typeof opt === 'object') {
          return {
            label: opt.label || opt.name || String(opt.value),
            value: String(opt.value || opt.id)
          };
        }
        return { label: String(opt), value: String(opt) };
      });
    }
    return field.options || [];
  };

  // Create handles array strings to trigger updates
  const fieldsStr = JSON.stringify(uiSchema.fields?.map(f => f.id) || []);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, fieldsStr, isVertical, updateNodeInternals]);

  // Extract select/radio fields that might need dynamic options
  const fieldsWithDynamicOptions = useMemo(() => {
    return (uiSchema.fields || []).filter(
      f => f.type === 'select' || f.type === 'multi-select' || f.type === 'radio'
    );
  }, [uiSchema.fields]);

  // Handle styles
  const handleClass = "!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none";

  const renderFormPreview = () => {
    if (!showPanel) return null;
    return (
      <div className={cn(
        "absolute bg-card text-card-foreground shadow-lg border border-border p-4 rounded-md w-80 max-h-[400px] overflow-y-auto z-10",
        isVertical ? "top-0 left-full ml-4" : "top-full mt-4 left-0"
      )}>
        <div className="text-xs font-semibold mb-3 pb-2 border-b border-border flex justify-between items-center">
          <span>{data.label || 'Form Preview'}</span>
          <span className="text-[8px] uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 font-bold">
            {uiSchema.layout?.triggerOn || 'submit'}
          </span>
        </div>

        <form onSubmit={handleSubmit} className={cn(
          "grid gap-4",
          uiSchema.layout?.columns === 2 ? "grid-cols-2" : "grid-cols-1"
        )}>
          {(!uiSchema.fields || uiSchema.fields.length === 0) ? (
            <div className="text-xs text-muted-foreground italic col-span-full">No fields defined</div>
          ) : (
            uiSchema.fields.map((field) => {
              const options = getFieldOptions(field);
              return (
                <div key={field.id} className="space-y-1.5 flex flex-col">
                  <Label className="text-[10px]">{field.label}{field.required && ' *'}</Label>

                  {field.type === 'textarea' ? (
                    <Textarea 
                      value={formValues[field.id] || ''} 
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                      onBlur={() => handleBlur(field.id)}
                      placeholder={field.placeholder} 
                      className="text-xs min-h-[60px]" 
                      disabled={field.props?.disabled as boolean} 
                    />
                  ) : field.type === 'select' ? (
                    <Select 
                      value={formValues[field.id] || ''} 
                      onValueChange={(val) => handleFieldChange(field.id, val, true)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={field.placeholder || 'Select...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((opt: any) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                        ))}
                        {options.length === 0 && <SelectItem value="none" disabled className="text-xs">No options</SelectItem>}
                      </SelectContent>
                    </Select>
                  ) : field.type === 'radio' ? (
                    <RadioGroup 
                      value={formValues[field.id] || ''} 
                      onValueChange={(val) => handleFieldChange(field.id, val, true)}
                      className="flex flex-col space-y-1 mt-1"
                    >
                      {options.map((opt: any) => (
                        <div key={opt.value} className="flex items-center space-x-2">
                          <RadioGroupItem value={opt.value} id={`${field.id}-${opt.value}`} />
                          <Label htmlFor={`${field.id}-${opt.value}`} className="text-xs font-normal">{opt.label}</Label>
                        </div>
                      ))}
                      {options.length === 0 && <span className="text-[10px] text-muted-foreground italic">No options</span>}
                    </RadioGroup>
                  ) : (
                    <Input
                      type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                      value={formValues[field.id] || ''}
                      onChange={(e) => handleFieldChange(field.id, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                      onBlur={() => handleBlur(field.id)}
                      placeholder={field.placeholder}
                      className="h-8 text-xs"
                      disabled={field.props?.disabled as boolean}
                    />
                  )}
                </div>
              );
            })
          )}

          {(uiSchema.layout?.showSubmit !== false && uiSchema.fields && uiSchema.fields.length > 0) && (
            <div className="col-span-full pt-2">
              <Button type="submit" className="w-full h-8 text-xs">{uiSchema.layout?.submitLabel || 'Submit'}</Button>
            </div>
          )}
        </form>
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
        {/* Top: Dynamic Options Inputs */}
        {fieldsWithDynamicOptions.map((field, idx) => (
          <Handle
            key={`handle-in-options_${field.id}`}
            type="target"
            position={Position.Top}
            id={`options_${field.id}`}
            style={{ left: `${((idx + 1) / (fieldsWithDynamicOptions.length + 1)) * 100}%` }}
            className={handleClass}
          />
        ))}

        {fieldsWithDynamicOptions.length > 0 && (
          <div className="flex justify-center gap-4 px-3 pt-3 pb-1">
            {fieldsWithDynamicOptions.map((field) => (
              <div key={`in-options_${field.id}`} className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] text-muted-foreground">options_{field.id}</span>
                <span className="text-[7px] font-medium text-muted-foreground/50 uppercase">ARRAY</span>
              </div>
            ))}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-y border-border/50 bg-muted/20">
          <div className="flex items-center justify-center w-5 h-5 bg-primary/10 text-primary">
            <AppWindow size={14} weight="duotone" />
          </div>
          <span className="text-[11px] font-semibold text-foreground truncate flex-1">
            {data.label || 'Input Form'}
          </span>
          <button 
            onClick={() => setShowPanel(!showPanel)} 
            className="text-muted-foreground hover:text-foreground transition-colors outline-none"
            title={showPanel ? "Hide Panel" : "Show Panel"}
          >
            {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
          </button>
          <button
            onClick={() => runFlow(getGraphJson(), id)}
            className="text-emerald-500 hover:text-emerald-400 transition-colors outline-none cursor-pointer"
            title="Run Downstream"
          >
            <Play size={14} weight="fill" />
          </button>
          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-primary/10 text-primary">UI</span>
        </div>

        {/* Bottom: Output Handle */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="values"
          style={{ left: '50%' }}
          className={handleClass}
        />
        <div className="flex justify-center px-3 pt-1 pb-3">
          <div className="flex flex-col items-center">
            <span className="text-[7px] font-medium text-muted-foreground/50 uppercase tracking-wide">OBJECT</span>
            <span className="text-[9px] text-muted-foreground">values</span>
          </div>
        </div>

        {/* Floating Form Preview */}
        {renderFormPreview()}
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
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
        <div className="flex items-center justify-center w-5 h-5 bg-primary/10 text-primary">
          <AppWindow size={14} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'Input Form'}
        </span>
        <button 
          onClick={() => setShowPanel(!showPanel)} 
          className="text-muted-foreground hover:text-foreground transition-colors outline-none"
          title={showPanel ? "Hide Panel" : "Show Panel"}
        >
          {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
        </button>
        <button
          onClick={() => runFlow(getGraphJson(), id)}
          className="text-emerald-500 hover:text-emerald-400 transition-colors outline-none cursor-pointer"
          title="Run Downstream"
        >
          <Play size={14} weight="fill" />
        </button>
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-primary/10 text-primary">UI</span>
      </div>

      {/* Body: Ports */}
      <div className="px-3 py-2">
        <div className="flex justify-between gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            {fieldsWithDynamicOptions.map((field) => (
              <div key={`in-options_${field.id}`} className="relative flex items-center gap-1.5 h-4">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`options_${field.id}`}
                  className={cn(handleClass, "!left-[-12px]")}
                  style={{ left: -15 }}
                />
                <span className="text-[10px] text-muted-foreground">options_{field.id}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 items-end min-w-0 w-full">
            <div className="relative flex items-center justify-end gap-1.5 h-4 w-full">
              <span className="text-[10px] text-muted-foreground">values</span>
              <Handle
                type="source"
                position={Position.Right}
                id="values"
                className={cn(handleClass, "!right-[-12px]")}
                style={{ right: -15 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Floating Form Preview */}
      {renderFormPreview()}
    </div>
  );
}

import { useFlowStore } from '../../../store/flowStore';
import type { UiInputField, UiInputSchema } from '@zaa-tool/shared';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Plus, Trash, Robot } from '@phosphor-icons/react';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import { AiFormBuilderDialog } from '../AiFormBuilderDialog';
import { useState } from 'react';

export function UiInputProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const uiSchema: UiInputSchema = node.data.uiSchema || { fields: [], layout: { columns: 1 } };
  const fields = uiSchema.fields || [];

  const updateSchema = (newSchema: Partial<UiInputSchema>) => {
    const nextSchema = { ...uiSchema, ...newSchema };
    
    // Sync to outputsSchema so AI and other nodes know the exact fields
    const newOutputsSchema = [{
      name: 'values',
      type: 'object' as const,
      fields: nextSchema.fields?.map(f => ({
        name: f.id,
        type: (f.type === 'number' ? 'number' : (f.type as string) === 'switch' || (f.type as string) === 'checkbox' ? 'boolean' : 'string') as any
      })) || []
    }];
    
    updateNodeData(nodeId, { 
      uiSchema: nextSchema,
      outputsSchema: newOutputsSchema
    });
  };

  const addField = () => {
    const newField: UiInputField = {
      id: `field_${Date.now()}`,
      type: 'text',
      label: 'New Field'
    };
    updateSchema({ fields: [...fields, newField] });
  };

  const updateField = (idx: number, patch: Partial<UiInputField>) => {
    const newFields = [...fields];
    newFields[idx] = { ...newFields[idx], ...patch };
    updateSchema({ fields: newFields });
  };

  const removeField = (idx: number) => {
    updateSchema({ fields: fields.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-6">
      <AiFormBuilderDialog 
        open={isAiDialogOpen} 
        onOpenChange={setIsAiDialogOpen} 
        nodeId={nodeId} 
        onApplySchema={updateSchema} 
        initialSchema={uiSchema}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Form Fields</span>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setIsAiDialogOpen(true)} className="h-6 px-2 text-[10px] bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">
            <Robot size={12} className="mr-1" /> AI
          </Button>
          <Button variant="ghost" size="sm" onClick={addField} className="h-6 px-2 text-[10px]">
            <Plus size={10} className="mr-1" /> Add
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {fields.length === 0 && <div className="text-xs text-muted-foreground italic">No fields defined.</div>}
        
        {fields.map((field, idx) => (
          <div key={idx} className="border border-border rounded-md p-3 space-y-3 relative group bg-muted/10">
            <Button 
              variant="ghost" 
              size="icon" 
              className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => removeField(idx)}
            >
              <Trash size={12} />
            </Button>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Field ID</Label>
                <Input value={field.id} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField(idx, { id: e.target.value })} className="h-7 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Type</Label>
                <Select value={field.type} onValueChange={(v: any) => updateField(idx, { type: v })}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="textarea">Textarea</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="select">Select</SelectItem>
                    <SelectItem value="radio">Radio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-1">
              <Label className="text-[10px]">Label</Label>
              <Input value={field.label} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField(idx, { label: e.target.value })} className="h-7 text-xs" />
            </div>
            
            <div className="flex items-center gap-2 pt-1">
              <Switch 
                id={`req-${idx}`} 
                checked={!!field.required} 
                onCheckedChange={(v: boolean) => updateField(idx, { required: v })} 
              />
              <Label htmlFor={`req-${idx}`} className="text-[10px]">Required</Label>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3 pt-4 border-t border-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Layout & Trigger</span>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px]">Columns</Label>
            <Select 
              value={uiSchema.layout?.columns?.toString() || '1'} 
              onValueChange={(v: string) => updateSchema({ layout: { ...uiSchema.layout, columns: parseInt(v) as 1|2|3|4 } })}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 Column</SelectItem>
                <SelectItem value="2">2 Columns</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-1">
            <Label className="text-[10px]">Trigger Flow On</Label>
            <Select 
              value={uiSchema.layout?.triggerOn || 'submit'} 
              onValueChange={(v: string) => updateSchema({ layout: { ...uiSchema.layout, triggerOn: v as 'submit'|'change' } })}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="submit">Submit Button</SelectItem>
                <SelectItem value="change">Field Change</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}

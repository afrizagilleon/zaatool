import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFlowStore } from '../../../store/flowStore';
import type { UiInputField, UiInputSchema } from '@zaa-tool/shared';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Plus, Trash, Robot, DotsSixVertical, CaretRight, CaretDown } from '@phosphor-icons/react';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import { AiFormBuilderDialog } from '../AiFormBuilderDialog';
import { cn } from '../../../lib/utils';

// Generate a slug ID from a label string
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field';
}

// Type badge colours per field type
const TYPE_COLOURS: Record<string, string> = {
  text: 'bg-blue-500/10 text-blue-500',
  textarea: 'bg-indigo-500/10 text-indigo-500',
  number: 'bg-orange-500/10 text-orange-500',
  select: 'bg-emerald-500/10 text-emerald-500',
  radio: 'bg-purple-500/10 text-purple-500',
};

interface SortableFieldProps {
  field: UiInputField;
  idx: number;
  isCollapsed: boolean;
  isChangeTrigger: boolean;
  idTouched: boolean;
  onToggleCollapse: () => void;
  onRemove: () => void;
  onFieldChange: (patch: Partial<UiInputField>, manualId?: boolean) => void;
}

function SortableField({
  field,
  idx,
  isCollapsed,
  isChangeTrigger,
  idTouched,
  onToggleCollapse,
  onRemove,
  onFieldChange,
}: SortableFieldProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleLabelChange = (label: string) => {
    onFieldChange({ label }, false);
  };

  const handleLabelBlur = () => {
    if (!idTouched) {
      const newId = slugify(field.label);
      if (newId !== field.id) {
        onFieldChange({ id: newId }, false);
      }
    }
  };

  const handleIdChange = (id: string) => {
    onFieldChange({ id }, true);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'border border-border rounded-md relative bg-muted/10',
        isDragging && 'z-50 shadow-lg'
      )}
    >
      {/* Field header row */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none"
          tabIndex={-1}
        >
          <DotsSixVertical size={14} />
        </button>

        {/* Collapse toggle */}
        <button
          onClick={onToggleCollapse}
          className="text-muted-foreground/60 hover:text-foreground shrink-0"
        >
          {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
        </button>

        {/* Summary when collapsed */}
        <button
          onClick={onToggleCollapse}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          <span className="text-[11px] font-medium text-foreground truncate">
            {field.label || <span className="text-muted-foreground italic">Untitled</span>}
          </span>
          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0', TYPE_COLOURS[field.type] || 'bg-muted text-muted-foreground')}>
            {field.type}
          </span>
          {field.required && !isChangeTrigger && (
            <span className="text-[9px] font-bold text-destructive shrink-0">required</span>
          )}
        </button>

        {/* Delete */}
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0"
          onClick={onRemove}
        >
          <Trash size={11} />
        </Button>
      </div>

      {/* Expanded editor */}
      {!isCollapsed && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50 pt-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Label</Label>
              <Input
                value={field.label}
                onChange={(e) => handleLabelChange(e.target.value)}
                onBlur={handleLabelBlur}
                className="h-7 text-xs"
                placeholder="Field label"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Type</Label>
              <Select value={field.type} onValueChange={(v: any) => onFieldChange({ type: v })}>
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
            <Label className="text-[10px] flex items-center gap-1">
              Field ID
              {!idTouched && (
                <span className="text-[8px] text-muted-foreground/50 font-normal normal-case">(auto)</span>
              )}
            </Label>
            <Input
              value={field.id}
              onChange={(e) => handleIdChange(e.target.value)}
              className="h-7 text-xs font-mono"
              placeholder="field_id"
            />
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <Switch
              id={`req-${idx}`}
              checked={!!field.required}
              onCheckedChange={(v) => onFieldChange({ required: v })}
              disabled={isChangeTrigger}
            />
            <Label
              htmlFor={`req-${idx}`}
              className={cn('text-[10px]', isChangeTrigger && 'text-muted-foreground/40')}
            >
              Required{isChangeTrigger && ' (n/a in change mode)'}
            </Label>
          </div>
        </div>
      )}
    </div>
  );
}

export function UiInputProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  // Set of field IDs whose ID has been manually edited (decoupled from label auto-sync)
  const [touchedIds, setTouchedIds] = useState<Set<string>>(new Set());
  // Set of field IDs that are collapsed
  const [collapsedFields, setCollapsedFields] = useState<Set<string>>(new Set());

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const uiSchema: UiInputSchema = node.data.uiSchema || { fields: [], layout: { columns: 1 } };
  const fields = uiSchema.fields || [];
  const isChangeTrigger = uiSchema.layout?.triggerOn === 'change';

  const updateSchema = useCallback((newSchema: Partial<UiInputSchema>) => {
    const nextSchema = { ...uiSchema, ...newSchema };

    const newOutputsSchema = [{
      name: 'values',
      type: 'object' as const,
      fields: nextSchema.fields?.map(f => ({
        name: f.id,
        type: (f.type === 'number' ? 'number' : 'string') as any,
      })) || [],
    }];

    updateNodeData(nodeId, {
      uiSchema: nextSchema,
      outputsSchema: newOutputsSchema,
      inputsSchema: [],
    });
  }, [uiSchema, nodeId, updateNodeData]);

  const addField = () => {
    const newField: UiInputField = {
      id: `field_${Date.now()}`,
      type: 'text',
      label: 'New Field',
    };
    updateSchema({ fields: [...fields, newField] });
  };

  const updateField = (idx: number, patch: Partial<UiInputField>, markIdTouched = false) => {
    const newFields = [...fields];
    const oldId = newFields[idx].id;
    newFields[idx] = { ...newFields[idx], ...patch };

    if (markIdTouched) {
      setTouchedIds(prev => {
        const next = new Set(prev);
        next.delete(oldId);
        next.add(patch.id ?? oldId);
        return next;
      });
    } else if (patch.id && patch.id !== oldId) {
      // ID auto-synced from label — if old was touched, transfer touch to new id
      setTouchedIds(prev => {
        if (!prev.has(oldId)) return prev;
        const next = new Set(prev);
        next.delete(oldId);
        next.add(patch.id!);
        return next;
      });
      // Also update collapsed key
      setCollapsedFields(prev => {
        if (!prev.has(oldId)) return prev;
        const next = new Set(prev);
        next.delete(oldId);
        next.add(patch.id!);
        return next;
      });
    }

    updateSchema({ fields: newFields });
  };

  const removeField = (idx: number) => {
    const fieldId = fields[idx].id;
    setTouchedIds(prev => { const n = new Set(prev); n.delete(fieldId); return n; });
    setCollapsedFields(prev => { const n = new Set(prev); n.delete(fieldId); return n; });
    updateSchema({ fields: fields.filter((_, i) => i !== idx) });
  };

  const toggleCollapse = (fieldId: string) => {
    setCollapsedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = fields.findIndex(f => f.id === active.id);
    const newIdx = fields.findIndex(f => f.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    updateSchema({ fields: arrayMove(fields, oldIdx, newIdx) });
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAiDialogOpen(true)}
            className="h-6 px-2 text-[10px] bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
          >
            <Robot size={12} className="mr-1" /> AI
          </Button>
          <Button variant="ghost" size="sm" onClick={addField} className="h-6 px-2 text-[10px]">
            <Plus size={10} className="mr-1" /> Add
          </Button>
        </div>
      </div>

      {fields.length === 0 && (
        <div className="text-xs text-muted-foreground italic">No fields defined.</div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {fields.map((field, idx) => (
              <SortableField
                key={field.id}
                field={field}
                idx={idx}
                isCollapsed={collapsedFields.has(field.id)}
                isChangeTrigger={isChangeTrigger}
                idTouched={touchedIds.has(field.id)}
                onToggleCollapse={() => toggleCollapse(field.id)}
                onRemove={() => removeField(idx)}
                onFieldChange={(patch, manualId) => updateField(idx, patch, manualId)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="space-y-3 pt-4 border-t border-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Layout & Trigger</span>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px]">Columns</Label>
            <Select
              value={uiSchema.layout?.columns?.toString() || '1'}
              onValueChange={(v) => updateSchema({ layout: { ...uiSchema.layout, columns: parseInt(v) as 1 | 2 | 3 | 4 } })}
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
              onValueChange={(v) => {
                const newLayout = { ...uiSchema.layout, triggerOn: v as 'submit' | 'change' };
                if (v === 'change') {
                  const clearedFields = fields.map(f => ({ ...f, required: false }));
                  updateSchema({ layout: newLayout, fields: clearedFields });
                } else {
                  updateSchema({ layout: newLayout });
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="submit">Submit Button</SelectItem>
                <SelectItem value="change">Field Change</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px]">Submit Button Label</Label>
          <Input
            value={uiSchema.layout?.submitLabel || 'Submit'}
            onChange={(e) => updateSchema({ layout: { ...uiSchema.layout, submitLabel: e.target.value } })}
            className="h-7 text-xs"
            placeholder="Submit"
          />
        </div>
      </div>
    </div>
  );
}

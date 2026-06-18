import { Plus, Trash } from '@phosphor-icons/react';
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

export function SchemaEditor({
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

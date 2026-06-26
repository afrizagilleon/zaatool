import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { Label } from '../../ui/label';

interface Option {
  label: string;
  value: string;
}

interface InputFormFieldProps {
  field: any;
  value: any;
  onChange: (value: any, triggerImmediately?: boolean) => void;
  onBlur: () => void;
  options: Option[];
  isBound: boolean;
  isDisabled: boolean;
  triggerImmediately: boolean;
}

export function InputFormField({
  field,
  value,
  onChange,
  onBlur,
  options,
  isBound,
  isDisabled,
  triggerImmediately,
}: InputFormFieldProps) {
  if (field.type === 'textarea') {
    return (
      <Textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={isBound ? 'Bound to dynamic input' : field.placeholder}
        className="text-xs min-h-[60px]"
        disabled={isDisabled}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <Select
        value={value || ''}
        onValueChange={(val) => onChange(val, triggerImmediately)}
        disabled={isDisabled}
      >
        <SelectTrigger className="h-8 text-xs" type="button">
          <SelectValue placeholder={isBound ? 'Dynamic Value' : (field.placeholder || 'Select...')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
          {options.length === 0 && (
            <SelectItem value="none" disabled className="text-xs">
              No options
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'radio') {
    return (
      <RadioGroup
        value={value || ''}
        onValueChange={(val) => onChange(val, triggerImmediately)}
        className="flex flex-col space-y-1 mt-1"
        disabled={isDisabled}
      >
        {options.map((opt) => (
          <div key={opt.value} className="flex items-center space-x-2">
            <RadioGroupItem value={opt.value} id={`${field.id}-${opt.value}`} disabled={isDisabled} type="button" />
            <Label htmlFor={`${field.id}-${opt.value}`} className="text-xs font-normal">
              {opt.label}
            </Label>
          </div>
        ))}
        {options.length === 0 && (
          <span className="text-[10px] text-muted-foreground italic">No options</span>
        )}
      </RadioGroup>
    );
  }

  return (
    <Input
      type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
      value={value || ''}
      onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
      onBlur={onBlur}
      placeholder={isBound ? 'Bound to dynamic input' : field.placeholder}
      className="h-8 text-xs"
      disabled={isDisabled}
    />
  );
}

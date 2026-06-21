import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Play } from '@phosphor-icons/react';
import { cn } from '../../lib/utils.js';

interface DashboardInputWidgetProps {
  node: any;
  formInputs: Record<string, any>;
  onInputChange: (fieldKey: string, val: any) => void;
  onFormSubmit: () => void;
  onAutoTrigger?: (latestInputs: Record<string, any>) => void;
  isExecuting: boolean;
  getFieldOptions: (field: any) => any[];
  fontSize?: number;
}

export function DashboardInputWidget({
  node,
  formInputs,
  onInputChange,
  onFormSubmit,
  onAutoTrigger,
  isExecuting,
  getFieldOptions,
  fontSize
}: DashboardInputWidgetProps) {
  const size = fontSize || 12;
  const triggerOn = node.data?.uiSchema?.layout?.triggerOn;
  const showSubmit =
    node.data?.uiSchema?.layout?.showSubmit !== false &&
    triggerOn !== 'change' &&
    node.data?.uiSchema?.fields?.length > 0;

  // select/radio: trigger immediately; compute fresh inputs before state update propagates
  const handleImmediateChange = (fieldId: string, val: any) => {
    onInputChange(fieldId, val);
    if (triggerOn === 'change') {
      onAutoTrigger?.({ ...formInputs, [fieldId]: val });
    }
  };

  // text/textarea/number: trigger on blur; by blur time formInputs prop is already updated
  const handleBlurTrigger = () => {
    if (triggerOn === 'change') {
      onAutoTrigger?.(formInputs);
    }
  };

  return (
    <div className="h-full flex flex-col justify-between">
      <div className="flex-1 flex flex-col space-y-3 min-h-0 overflow-y-auto pb-2">
        {node.data?.uiSchema?.fields?.map((f: any, idx: number) => {
          return (
            <div
              key={f.id || idx}
              className={cn("space-y-1.5 flex flex-col", f.type === 'textarea' ? "flex-1 min-h-0" : "shrink-0")}
            >
              <Label className="font-semibold text-muted-foreground" style={{ fontSize: `${size - 1}px` }}>
                {f.label || f.id}
              </Label>
              {f.type === 'textarea' ? (
                <textarea
                  className="flex-1 min-h-[100px] w-full bg-background border border-border rounded-lg p-3 font-mono focus:outline-none focus:border-primary resize-none text-foreground leading-relaxed"
                  style={{ fontSize: `${size}px` }}
                  value={formInputs[f.id] || ''}
                  onChange={(e) => onInputChange(f.id, e.target.value)}
                  onBlur={handleBlurTrigger}
                />
              ) : f.type === 'select' ? (
                <Select
                  value={formInputs[f.id] || ''}
                  onValueChange={(val) => handleImmediateChange(f.id, val)}
                >
                  <SelectTrigger
                    className="h-8.5 w-full bg-background border-border text-foreground"
                    style={{ fontSize: `${size}px` }}
                  >
                    <SelectValue placeholder={f.placeholder || 'Select...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {getFieldOptions(f).map((opt: any) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                    {getFieldOptions(f).length === 0 && (
                      <SelectItem value="none" disabled className="text-xs">
                        No options
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              ) : f.type === 'radio' ? (
                <RadioGroup
                  value={formInputs[f.id] || ''}
                  onValueChange={(val) => handleImmediateChange(f.id, val)}
                  className="flex flex-col space-y-1 mt-1"
                >
                  {getFieldOptions(f).map((opt: any) => (
                    <div key={opt.value} className="flex items-center space-x-2">
                      <RadioGroupItem value={opt.value} id={`${node.id}-${f.id}-${opt.value}`} />
                      <Label
                        htmlFor={`${node.id}-${f.id}-${opt.value}`}
                        style={{ fontSize: `${size}px` }}
                        className="font-normal"
                      >
                        {opt.label}
                      </Label>
                    </div>
                  ))}
                  {getFieldOptions(f).length === 0 && (
                    <span className="text-[10px] text-muted-foreground italic">No options</span>
                  )}
                </RadioGroup>
              ) : (
                <Input
                  type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
                  className="h-8.5 bg-background border-border text-foreground shrink-0"
                  style={{ fontSize: `${size}px` }}
                  value={formInputs[f.id] || ''}
                  onChange={(e) => onInputChange(f.id, e.target.value)}
                  onBlur={handleBlurTrigger}
                />
              )}
            </div>
          );
        })}
      </div>
      {showSubmit && (
        <Button
          onClick={onFormSubmit}
          className="w-full h-8.5 bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs flex items-center justify-center gap-1.5 mt-2 shrink-0 rounded-lg"
          disabled={isExecuting}
        >
          <Play weight="fill" className="w-3 h-3" />
          {node.data?.uiSchema?.layout?.submitLabel || 'Submit'}
        </Button>
      )}
    </div>
  );
}

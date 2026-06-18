import { cn } from '../../../lib/utils';
import { Label } from '../../ui/label';
import { Button } from '../../ui/button';
import { InputFormField } from './InputFormField';
import type { FlowNodeData } from '../../../store/flowStore';

interface InputFormPreviewProps {
  showPanel: boolean;
  isVertical: boolean;
  data: FlowNodeData;
  uiSchema: NonNullable<FlowNodeData['uiSchema']>;
  formValues: Record<string, any>;
  dynamicValues: Record<string, any>;
  handleFieldChange: (fieldId: string, value: any, triggerImmediately?: boolean) => void;
  handleBlur: (fieldId: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  getFieldOptions: (field: any) => { label: string; value: string }[];
}

export function InputFormPreview({
  showPanel,
  isVertical,
  data,
  uiSchema,
  formValues,
  dynamicValues,
  handleFieldChange,
  handleBlur,
  handleSubmit,
  getFieldOptions,
}: InputFormPreviewProps) {
  if (!showPanel) return null;

  return (
    <div
      className={cn(
        'absolute bg-card text-card-foreground shadow-lg border border-border p-4 rounded-md w-80 max-h-[400px] overflow-y-auto z-10',
        isVertical ? 'top-0 left-full ml-4' : 'top-full mt-4 left-0'
      )}
    >
      <div className="text-xs font-semibold mb-3 pb-2 border-b border-border flex justify-between items-center">
        <span>{data.label || 'Form Preview'}</span>
        <span className="text-[8px] uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 font-bold">
          {uiSchema.layout?.triggerOn || 'submit'}
        </span>
      </div>

      <form
        onSubmit={handleSubmit}
        className={cn('grid gap-4', uiSchema.layout?.columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}
      >
        {(!uiSchema.fields || uiSchema.fields.length === 0) ? (
          <div className="text-xs text-muted-foreground italic col-span-full">No fields defined</div>
        ) : (
          uiSchema.fields.map((field) => {
            const options = getFieldOptions(field);
            const isBound = dynamicValues[field.id] !== undefined;
            const isDisabled = isBound || (field.props?.disabled as boolean);
            return (
              <div key={field.id} className="space-y-1.5 flex flex-col">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">
                    {field.label}{field.required && ' *'}
                  </Label>
                  {isBound && (
                    <span className="text-[7px] font-bold text-primary bg-primary/10 px-1 py-0.5 rounded uppercase">
                      Dynamic
                    </span>
                  )}
                </div>
                <InputFormField
                  field={field}
                  value={formValues[field.id]}
                  onChange={(value, triggerImmediately) => handleFieldChange(field.id, value, triggerImmediately)}
                  onBlur={() => handleBlur(field.id)}
                  options={options}
                  isBound={isBound}
                  isDisabled={isDisabled}
                  triggerImmediately={uiSchema.layout?.triggerOn === 'change'}
                />
              </div>
            );
          })
        )}

        {(uiSchema.layout?.showSubmit !== false && uiSchema.fields && uiSchema.fields.length > 0) && (
          <div className="col-span-full pt-2">
            <Button type="submit" className="w-full h-8 text-xs">
              {uiSchema.layout?.submitLabel || 'Submit'}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

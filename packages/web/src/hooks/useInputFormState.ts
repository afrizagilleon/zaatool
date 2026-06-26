import { useEffect, useMemo, useState } from 'react';
import { useFlowStore } from '../store/flowStore';
import { useEngineStore } from '../store/engineStore';
import type { FlowNodeData } from '../store/flowStore';

export interface InputFormState {
  formValues: Record<string, any>;
  dynamicValues: Record<string, any>;
  handleFieldChange: (fieldId: string, value: any, triggerImmediately?: boolean) => void;
  handleBlur: (fieldId: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  getFieldOptions: (field: any) => { label: string; value: string }[];
}

export function useInputFormState(id: string, data: FlowNodeData): InputFormState {
  const uiSchema = data.uiSchema || { fields: [], layout: { columns: 1 } };
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const runFlow = useEngineStore((s) => s.runFlow);
  const getGraphJson = useFlowStore((s) => s.getGraphJson);

  const [formValues, setFormValues] = useState<Record<string, any>>({});

  const dynamicValues = useMemo(() => {
    const vals: Record<string, any> = {};
    if (data.inputs) {
      for (const [key, val] of Object.entries(data.inputs)) {
        if (key.startsWith('value_')) {
          const fieldId = key.replace('value_', '');
          vals[fieldId] = val;
        }
      }
    }
    return vals;
  }, [data.inputs]);

  useEffect(() => {
    setFormValues({
      ...(data.values || {}),
      ...dynamicValues,
    });
  }, [data.values, dynamicValues]);

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

  const getFieldOptions = (field: any): { label: string; value: string }[] => {
    const dynamicOpts = data.inputs?.[`options_${field.id}`];
    if (Array.isArray(dynamicOpts)) {
      return dynamicOpts.map((opt) => {
        if (typeof opt === 'string') return { label: opt, value: opt };
        if (opt && typeof opt === 'object') {
          return {
            label: opt.label || opt.name || String(opt.value),
            value: String(opt.value || opt.id),
          };
        }
        return { label: String(opt), value: String(opt) };
      });
    }
    return field.options || [];
  };

  return { formValues, dynamicValues, handleFieldChange, handleBlur, handleSubmit, getFieldOptions };
}

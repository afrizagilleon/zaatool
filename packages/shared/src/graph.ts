export interface GraphJson {
  version: string;
  id: string;
  name: string;
  nodes: NodeDef[];
  edges: EdgeDef[];
  viewport?: { x: number; y: number; zoom: number };
  layoutDirection?: 'LR' | 'TB';
}

export interface NodeDef {
  id: string;
  type: "code" | "if" | "loop" | "http" | "input" | "output" | "ui:input" | "ui:table" | "ui:text" | "ui:image" | "ui:chart" | "file" | "trigger:start" | "trigger:cron";
  runtime?: "node" | "python";
  position: { x: number; y: number };
    data: {
      label: string;
      code?: string;
      inputsSchema: SchemaField[];
      outputsSchema: SchemaField[];
      config?: Record<string, unknown>;
      uiSchema?: UiInputSchema;
      tableConfig?: UiTableConfig;
      chartConfig?: UiChartConfig;
      inputs?: Record<string, any>;
      outputs?: Record<string, any>;
      values?: Record<string, any>;
      selectedRow?: any;
      format?: string;
      cronExpression?: string;
      enabled?: boolean;
      showInDashboard?: boolean;
      showPanel?: boolean;
    };
}

export interface UiChartConfig {
  type: 'bar' | 'line' | 'area' | 'pie';
  xAxisKey?: string;
  yAxisKeys?: string[];
  colors?: string[];
  jsonConfig?: string;
}

export interface EdgeDef {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  isActive?: string;
}

export const SCHEMA_FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object', 'table', 'image', 'file', 'any'] as const;
export type SchemaFieldType = typeof SCHEMA_FIELD_TYPES[number];

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  description?: string;
  fields?: SchemaField[]; // for type "object", this is the defintion of the object type (recursive)
  items?: SchemaField; // for type "array", this is the defintion of the array items type
  required?: boolean;
}

export interface UiInputField {
  id: string;
  type: 'text' | 'textarea' | 'select' | 'multi-select' | 'radio' | 'password' | 'number' | 'email';
  label: string;
  placeholder?: string;
  required?: boolean;
  replaceable?: boolean;
  defaultValue?: unknown;
  options?: { value: string; label: string }[];
  props?: {
    maxLength?: number;
    minLength?: number;
    disabled?: boolean;
    rows?: number;
    min?: number;
    max?: number;
    step?: number;
    searchable?: boolean;
    [key: string]: unknown;
  };
}

export interface UiInputLayout {
  columns?: 1 | 2 | 3 | 4;
  gap?: 'sm' | 'md' | 'lg';
  submitLabel?: string;
  showSubmit?: boolean;
  triggerOn?: 'submit' | 'change';
}

export interface UiInputSchema {
  fields: UiInputField[];
  layout?: UiInputLayout;
}

export interface UiTableColumn {
  key: string;
  header: string;
  width?: number;
  sortable?: boolean;
  format?: 'text' | 'number' | 'date' | 'badge' | 'link';
}

export interface UiTableConfig {
  columns?: UiTableColumn[];
  pagination?: boolean;
  pageSize?: number;
  selectable?: boolean;
  striped?: boolean;
  compact?: boolean;
  autoColumns?: boolean;
}

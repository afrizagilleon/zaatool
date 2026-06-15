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
  type: "code" | "if" | "loop" | "http" | "input" | "output";
  runtime?: "node" | "python";
  position: { x: number; y: number };
  data: {
    label: string;
    code?: string;
    inputsSchema: SchemaField[];
    outputsSchema: SchemaField[];
    config?: Record<string, unknown>;
  };
}

export interface EdgeDef {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  isActive?: string;
}

export const SCHEMA_FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object', 'any'] as const;
export type SchemaFieldType = typeof SCHEMA_FIELD_TYPES[number];

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  description?: string;
  fields?: SchemaField[]; // for type "object", this is the defintion of the object type (recursive)
  items?: SchemaField; // for type "array", this is the defintion of the array items type
  required?: boolean;
}



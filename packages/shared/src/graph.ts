export interface GraphJson {
  version: string;
  id: string;
  name: string;
  nodes: NodeDef[];
  edges: EdgeDef[];
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

export interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
}



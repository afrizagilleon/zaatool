import type { Edge, Node, OnNodesChange, OnEdgesChange, OnConnect } from '@xyflow/react';
import type { GraphJson, NodeDef, SchemaField } from '@zaa-tool/shared';

export type FlowNodeData = NodeDef['data'] & {
  runtime?: 'node' | 'python';
  inferredOutputsSchema?: SchemaField[];
  inputs?: Record<string, any>;
};

export type FlowNode = Node<FlowNodeData, string>;

export interface FlowState {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: Edge[];
  activeNodeId: string | null;
  viewport: { x: number; y: number; zoom: number };
  dashboardLayout: any;
  dashboardPassword: string;

  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setDashboardLayout: (layout: any) => void;
  setFlowName: (name: string) => void;
  setDashboardPassword: (password: string) => void;

  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setActiveNodeId: (id: string | null) => void;
  updateNodeData: (id: string, data: Partial<FlowNodeData>) => void;
  updateSchemaField: (
    nodeId: string,
    schemaType: 'inputsSchema' | 'outputsSchema',
    index: number,
    patch: Partial<SchemaField>
  ) => void;
  addNode: (node: FlowNode) => void;
  removeNode: (id: string) => void;
  getGraphJson: () => GraphJson;
  loadFromJson: (graph: GraphJson) => void;
}

let nodeIdCounter = 0;
export const generateNodeId = () => `node_${Date.now()}_${nodeIdCounter++}`;

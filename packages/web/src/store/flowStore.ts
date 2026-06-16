import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import { useUiStore } from './uiStore';
import type {
  Connection,
  Edge,
  Node,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
} from '@xyflow/react';
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

  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setDashboardLayout: (layout: any) => void;

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

export const useFlowStore = create<FlowState>((set, get) => ({
  id: 'flow-1',
  name: 'My Flow',
  nodes: [],
  edges: [],
  activeNodeId: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  dashboardLayout: { items: [] },
  setDashboardLayout: (layout) => set({ dashboardLayout: layout }),

  setViewport: (viewport) => set({ viewport }),

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(
        {
          ...connection,
          id: `e_${connection.source}_${connection.sourceHandle}_${connection.target}_${connection.targetHandle}`,
        },
        get().edges,
      ),
    });
  },

  setActiveNodeId: (id) => {
    set({ activeNodeId: id });
  },

  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id === id) {
          return { ...node, data: { ...node.data, ...data } };
        }
        return node;
      }),
    });
  },

  updateSchemaField: (nodeId, schemaType, index, patch) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const schema = node.data[schemaType] || [];
    if (index < 0 || index >= schema.length) return;

    const oldField = schema[index];
    const newField = { ...oldField, ...patch };
    const newSchema = schema.map((f, i) => (i === index ? newField : f));

    // Update edges if name changed
    let newEdges = state.edges;
    if (patch.name && patch.name !== oldField.name) {
      newEdges = state.edges.map((e) => {
        if (schemaType === 'outputsSchema' && e.source === nodeId && e.sourceHandle === oldField.name) {
          return { ...e, sourceHandle: patch.name, id: `e_${e.source}_${patch.name}_${e.target}_${e.targetHandle}` };
        }
        if (schemaType === 'inputsSchema' && e.target === nodeId && e.targetHandle === oldField.name) {
          return { ...e, targetHandle: patch.name, id: `e_${e.source}_${e.sourceHandle}_${e.target}_${patch.name}` };
        }
        return e;
      });
    }

    set({
      nodes: state.nodes.map((n) => {
        if (n.id === nodeId) {
          return { ...n, data: { ...n.data, [schemaType]: newSchema } };
        }
        return n;
      }),
      edges: newEdges,
    });
  },

  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
  },

  removeNode: (id) => {
    const state = get();
    set({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      activeNodeId: state.activeNodeId === id ? null : state.activeNodeId,
    });
  },

  getGraphJson: () => {
    const { id, name, nodes, edges, viewport, dashboardLayout } = get();
    // Retrieve layoutDirection from uiStore (safe to read synchronously)
    const layoutDirection = useUiStore.getState().layoutDirection;

    return {
      version: '2.0',
      id,
      name,
      viewport,
      layoutDirection,
      dashboardLayout,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as NodeDef['type'],
        runtime: (n.data.runtime as 'node' | 'python') || undefined,
        position: n.position,
        data: {
          label: n.data.label,
          code: n.data.code,
          inputsSchema: n.data.inputsSchema,
          outputsSchema: n.data.outputsSchema,
          config: n.data.config,
          uiSchema: n.data.uiSchema,
          tableConfig: n.data.tableConfig,
          inputs: n.data.inputs,
          values: n.data.values,
          selectedRow: n.data.selectedRow,
        },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle || '',
        target: e.target,
        targetHandle: e.targetHandle || '',
      })),
    } as any;
  },

  loadFromJson: (graph: any) => {
    if (!graph) return;
    set({
      id: graph.id || 'flow-1',
      name: graph.name || 'Untitled Flow',
      viewport: graph.viewport || { x: 0, y: 0, zoom: 1 },
      dashboardLayout: graph.dashboardLayout || { items: [] },
      nodes: (graph.nodes || []).map((n: any) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          ...n.data,
          runtime: n.runtime,
        },
      })),
      edges: (graph.edges || []).map((e: any) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
      })),
      activeNodeId: null,
    });
    
    if (graph.layoutDirection) {
      useUiStore.getState().setLayoutDirection(graph.layoutDirection);
    }
  },
}));

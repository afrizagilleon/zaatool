import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { useUiStore } from './uiStore';
import { serializeFlow, deserializeFlow } from '../lib/flow-serializer';
import type { Connection } from '@xyflow/react';
import type { GraphJson, DashboardLayout } from '@zaa-tool/shared';
import type { FlowState, FlowNode } from './flowTypes';

export type { FlowNodeData, FlowNode, FlowState } from './flowTypes';
export { generateNodeId } from './flowTypes';

export const useFlowStore = create<FlowState>((set, get) => ({
  id: 'flow-1',
  name: 'My Flow',
  nodes: [],
  edges: [],
  activeNodeId: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  dashboardLayout: { items: [] },
  dashboardPassword: '',

  setDashboardLayout: (layout: DashboardLayout) => set({ dashboardLayout: layout }),
  setFlowName: (name) => set({ name }),
  setDashboardPassword: (password) => set({ dashboardPassword: password }),
  setViewport: (viewport) => set({ viewport }),

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
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

  setActiveNodeId: (id) => set({ activeNodeId: id }),

  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...data } } : node,
      ),
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
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, [schemaType]: newSchema } } : n,
      ),
      edges: newEdges,
    });
  },

  addNode: (node: FlowNode) => set({ nodes: [...get().nodes, node] }),

  removeNode: (id) => {
    const state = get();
    set({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      activeNodeId: state.activeNodeId === id ? null : state.activeNodeId,
    });
  },

  getGraphJson: () => {
    const state = get();
    const layoutDirection = useUiStore.getState().layoutDirection;
    return serializeFlow(state, layoutDirection);
  },

  loadFromJson: (graph: GraphJson) => {
    if (!graph) return;
    const deserialized = deserializeFlow(graph as GraphJson & { dashboardPassword?: string });
    set(deserialized);

    if ((graph as GraphJson & { layoutDirection?: string }).layoutDirection) {
      useUiStore.getState().setLayoutDirection(
        (graph as GraphJson & { layoutDirection: 'LR' | 'TB' }).layoutDirection
      );
    }
  },
}));

import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { useUiStore } from './uiStore';
import { serializeFlow, deserializeFlow } from '../lib/flow-serializer';
import { withPropagatedInput, withClearedInput } from '../lib/edgePropagation';
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
  isPublished: true,
  shareSlug: null,

  setDashboardLayout: (layout: DashboardLayout) => set({ dashboardLayout: layout }),
  setFlowName: (name) => set({ name }),
  setDashboardPassword: (password) => set({ dashboardPassword: password }),
  setIsPublished: (val) => set({ isPublished: val }),
  setShareSlug: (val) => set({ shareSlug: val }),
  setViewport: (viewport) => set({ viewport }),

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    const currentEdges = get().edges;

    // Clear stale data on a disconnected display node instead of leaving it showing
    // the last value it had while still connected.
    changes.forEach((change) => {
      if (change.type !== 'remove') return;
      const edge = currentEdges.find((e) => e.id === change.id);
      if (!edge?.targetHandle) return;
      const targetNode = get().nodes.find((n) => n.id === edge.target);
      if (!targetNode) return;
      get().updateNodeData(edge.target, {
        inputs: withClearedInput(targetNode.data.inputs, edge.targetHandle),
      });
    });

    set({ edges: applyEdgeChanges(changes, currentEdges) });
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

    // Carry forward the source's last known output so the newly-wired node
    // updates immediately without requiring a full flow re-run.
    const { source, sourceHandle, target, targetHandle } = connection;
    if (!source || !sourceHandle || !target || !targetHandle) return;

    const sourceNode = get().nodes.find((n) => n.id === source);
    const cachedValue = sourceNode?.data.outputs?.[sourceHandle];
    if (cachedValue === undefined) return;

    const targetNode = get().nodes.find((n) => n.id === target);
    if (!targetNode) return;

    get().updateNodeData(target, {
      inputs: withPropagatedInput(targetNode.data.inputs, targetHandle, cachedValue),
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

    // Clear propagated values on downstream nodes fed by this node, same as a
    // manual edge removal would, so deleting a node doesn't leave stale data
    // (e.g. an image src) cached on nodes it used to feed.
    let nodes = state.nodes;
    state.edges.forEach((edge) => {
      if (edge.source !== id || !edge.targetHandle) return;
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!targetNode) return;
      nodes = nodes.map((n) =>
        n.id === edge.target
          ? { ...n, data: { ...n.data, inputs: withClearedInput(n.data.inputs, edge.targetHandle as string) } }
          : n,
      );
    });

    set({
      nodes: nodes.filter((n) => n.id !== id),
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

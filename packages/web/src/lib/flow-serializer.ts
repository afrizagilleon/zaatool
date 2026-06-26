import type { GraphJson, NodeDef, DashboardLayout } from "@zaa-tool/shared";
import type { FlowState, FlowNode } from "../store/flowTypes.js";

export function serializeFlow(state: Pick<FlowState, "id" | "name" | "nodes" | "edges" | "viewport" | "dashboardLayout">, layoutDirection: "LR" | "TB"): GraphJson {
  return {
    version: "2.0",
    id: state.id,
    name: state.name,
    viewport: state.viewport,
    layoutDirection,
    dashboardLayout: state.dashboardLayout,
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type as NodeDef["type"],
      runtime: (n.data.runtime as "node" | "python") || undefined,
      position: n.position,
      data: {
        label: n.data.label,
        code: n.data.code,
        inputsSchema: n.data.inputsSchema,
        outputsSchema: n.data.outputsSchema,
        config: n.data.config,
        runCondition: n.data.runCondition,
        uiSchema: n.data.uiSchema,
        tableConfig: n.data.tableConfig,
        chartConfig: n.data.chartConfig,
        inputs: n.data.inputs,
        outputs: n.data.outputs,
        values: n.data.values,
        selectedRow: n.data.selectedRow,
        format: n.data.format,
        cronExpression: n.data.cronExpression,
        enabled: n.data.enabled,
        showInDashboard: n.data.showInDashboard,
        showPanel: n.data.showPanel,
      },
    })),
    edges: state.edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle || "",
      target: e.target,
      targetHandle: e.targetHandle || "",
    })),
  };
}

export function deserializeFlow(graph: GraphJson & { dashboardPassword?: string; is_published?: boolean; share_slug?: string | null }): {
  id: string;
  name: string;
  viewport: { x: number; y: number; zoom: number };
  dashboardLayout: DashboardLayout;
  dashboardPassword: string;
  isPublished: boolean;
  shareSlug: string | null;
  nodes: FlowNode[];
  edges: FlowState["edges"];
  activeNodeId: null;
} {
  const nodes: FlowNode[] = (graph.nodes || []).map((n) => {
    const inputsSchema = n.data?.inputsSchema || [];
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      data: { ...n.data, inputsSchema, runtime: n.runtime },
    } as FlowNode;
  });

  return {
    id: graph.id || "flow-1",
    name: graph.name || "Untitled Flow",
    viewport: graph.viewport || { x: 0, y: 0, zoom: 1 },
    dashboardLayout: graph.dashboardLayout || { items: [] },
    dashboardPassword: graph.dashboardPassword || "",
    isPublished: graph.is_published !== false,
    shareSlug: graph.share_slug || null,
    nodes,
    edges: (graph.edges || []).map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
    })),
    activeNodeId: null,
  };
}

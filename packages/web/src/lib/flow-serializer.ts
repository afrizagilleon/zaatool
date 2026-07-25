import type { GraphJson, NodeDef, DashboardLayout, SeedOutputs } from "@zaa-tool/shared";
import type { FlowState, FlowNode } from "../store/flowTypes.js";

/**
 * `data.inputs` holds values propagated from upstream nodes at run time and so
 * is not part of a flow's definition — except on `file` nodes, where
 * `inputs.file` is the file the user picked in the properties panel. Both the
 * engine (`file.executor`, `scope-initializer`) and the dashboard read that
 * selection back, so it has to survive a save.
 */
function serializeInputs(node: FlowNode): Record<string, unknown> | undefined {
  if (node.type !== "file") return undefined;
  const file = node.data.inputs?.file;
  return file === undefined ? undefined : { file };
}

/**
 * Collects the outputs currently held on the canvas, to be sent alongside a run
 * request so a partial re-run can start mid-graph. These belong to this editing
 * session only — they are deliberately not part of {@link serializeFlow}.
 */
export function collectSeedOutputs(nodes: FlowNode[]): SeedOutputs {
  const seed: SeedOutputs = {};
  for (const node of nodes) {
    const outputs = node.data.outputs;
    if (outputs && typeof outputs === "object" && Object.keys(outputs).length > 0) {
      seed[node.id] = outputs as Record<string, unknown>;
    }
  }
  return seed;
}

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
        // Run-time results are never persisted: a saved graph is a definition,
        // not a snapshot of the last execution.
        inputs: serializeInputs(n),
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

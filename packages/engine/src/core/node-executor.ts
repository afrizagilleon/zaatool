import type { GraphJson, NodeDef } from "@zaa-tool/shared";
import { EventEmitter } from "node:events";
import { Scope } from "./scope.js";
import { inferSchema } from "../utils/infer-schema.js";
import { truncateLog } from "./utils.js";
import type { ExecutorRegistry } from "./types.js";

export interface ExecuteNodeParams {
  nodeId: string;
  nodeMap: Map<string, NodeDef>;
  graph: GraphJson;
  scope: Scope;
  activeEdges: Set<string>;
  startNodeId: string | undefined;
  runSubFlow: (nodeIds: string[], scope: Scope) => Promise<void>;
  ee?: EventEmitter;
  registry: ExecutorRegistry;
}

export async function executeNode(params: ExecuteNodeParams): Promise<{ success: boolean; error?: string }> {
  const { nodeId, nodeMap, graph, scope, activeEdges, startNodeId, runSubFlow, ee, registry } = params;

  const node = nodeMap.get(nodeId)!;
  const incomingEdges = graph.edges.filter((e) => e.target === nodeId);

  const inputs: Record<string, unknown> = {};
  for (const edge of incomingEdges) {
    const sourceNode = nodeMap.get(edge.source);
    const isStaticNode = sourceNode && ["ui:input", "file", "ui:table"].includes(sourceNode.type);
    const sourceOutput = scope.get(edge.source);
    if (
      !startNodeId ||
      activeEdges.has(edge.id) ||
      isStaticNode ||
      edge.target === startNodeId ||
      sourceOutput !== undefined
    ) {
      const output = sourceOutput ?? {};
      inputs[edge.targetHandle] = (output as Record<string, unknown>)[edge.sourceHandle];
    }
  }

  // Inject form context: all ui:input values available as inputs.form
  // inputs.form = flat merge (last wins by topo order)
  // inputs.form.__nodes['Label'] = per-form namespace for conflict resolution
  const formFlat: Record<string, unknown> = {};
  const formByLabel: Record<string, Record<string, unknown>> = {};
  for (const n of graph.nodes) {
    if (n.type === "ui:input") {
      const scopeOutput = scope.get(n.id) as Record<string, unknown> | undefined;
      const values = ((scopeOutput?.values ?? n.data.values) || {}) as Record<string, unknown>;
      const label = n.data.label || n.id;
      Object.assign(formFlat, values);
      formByLabel[label] = values;
    }
  }
  inputs.form = { ...formFlat, __nodes: formByLabel };

  // Evaluate runCondition before executing — skip node if false
  const runCondition = node.data.runCondition?.trim();
  if (runCondition) {
    try {
      // eslint-disable-next-line no-new-func
      const condFn = new Function("inputs", `"use strict"; return !!(${runCondition});`);
      const shouldRun = condFn(inputs) as boolean;
      if (!shouldRun) {
        console.log(`\n⏭ [${nodeId}] ${node.data.label} (SKIPPED: runCondition false)`);
        ee?.emit("node:skip", { type: "node:skip", nodeId, reason: runCondition });
        // Produce null outputs so downstream nodes receive null (not stale cache)
        const nullOutputs = Object.fromEntries(
          node.data.outputsSchema.map((s) => [s.name, null])
        );
        scope.set(nodeId, nullOutputs);
        // All outgoing edges stay inactive (not added to activeEdges)
        return { success: true };
      }
    } catch (e) {
      return { success: false, error: `runCondition error in "${node.data.label}": ${(e as Error).message}` };
    }
  }

  console.log(`\n▶ [${nodeId}] ${node.data.label}`);
  console.log(`  inputs:`, truncateLog(inputs));

  const key =
    node.type === "code" && node.runtime ? `${node.type}:${node.runtime}` : node.type;
  const executor = registry.get(key);
  if (!executor) {
    throw new Error(`Executor not found for node type: ${key}`);
  }

  const startTime = Date.now();
  ee?.emit("node:start", { type: "node:start", nodeId });

  const result = await executor.execute({ node, inputs, graph, scope, runSubFlow, ee });

  if (result.error) {
    ee?.emit("node:error", { type: "node:error", nodeId, error: result.error, stack: "" });
    return { success: false, error: result.error };
  }

  const inferredOutputs = Object.entries(result.output ?? ({} as Record<string, unknown>)).map(
    ([key, val]) => inferSchema(val, key)
  );

  ee?.emit("node:done", {
    type: "node:done",
    nodeId,
    output: result.output ?? {},
    ms: Date.now() - startTime,
    activeHandle: result.activeHandle,
    activeHandles: result.activeHandles,
    inferredOutputsSchema: inferredOutputs,
  });

  scope.set(nodeId, result.output ?? {});

  for (const edge of graph.edges.filter((e) => e.source === nodeId)) {
    const isActive =
      (!result.activeHandle && !result.activeHandles) ||
      (result.activeHandle && edge.sourceHandle === result.activeHandle) ||
      (result.activeHandles && result.activeHandles.includes(edge.sourceHandle));

    if (isActive) activeEdges.add(edge.id);
  }

  return { success: true };
}

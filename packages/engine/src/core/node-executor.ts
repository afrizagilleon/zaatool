import type { GraphJson } from "@zaa-tool/shared";
import { EventEmitter } from "node:events";
import { Scope } from "./scope.js";
import { defaultExecutorRegistry } from "./registry.js";
import { inferSchema } from "../utils/infer-schema.js";
import { truncateLog } from "./utils.js";

export interface ExecuteNodeParams {
  nodeId: string;
  nodeMap: Map<string, any>;
  graph: GraphJson;
  scope: Scope;
  activeEdges: Set<string>;
  startNodeId: string | undefined;
  runSubFlow: (nodeIds: string[], scope: Scope) => Promise<void>;
  ee?: EventEmitter;
}

export async function executeNode(params: ExecuteNodeParams): Promise<{ success: boolean; error?: string }> {
  const { nodeId, nodeMap, graph, scope, activeEdges, startNodeId, runSubFlow, ee } = params;

  const node = nodeMap.get(nodeId)!;
  const incomingEdges = graph.edges.filter((e) => e.target === nodeId);

  const inputs: Record<string, unknown> = {};
  for (const edge of incomingEdges) {
    const sourceNode = nodeMap.get(edge.source);
    const isStaticNode = sourceNode && ["ui:input", "file", "ui:table"].includes(sourceNode.type);
    const sourceOutput = scope.get(edge.source);
    if (!startNodeId || activeEdges.has(edge.id) || isStaticNode || edge.target === startNodeId || sourceOutput !== undefined) {
      const output = sourceOutput ?? {};
      inputs[edge.targetHandle] = output[edge.sourceHandle];
    }
  }

  console.log(`\n▶ [${nodeId}] ${node.data.label}`);
  console.log(`  inputs:`, truncateLog(inputs));

  const key = node.type === "code" && node.runtime ? `${node.type}:${node.runtime}` : node.type;
  const executor = defaultExecutorRegistry.get(key);
  if (!executor) {
    throw new Error(`Executor not found for ${key}`);
  }

  const startTime = Date.now();
  ee?.emit("node:start", { type: "node:start", nodeId });

  const result = await executor.execute({
    node,
    inputs,
    graph,
    scope,
    runSubFlow,
    ee,
  });

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

    if (isActive) {
      activeEdges.add(edge.id);
    }
  }

  return { success: true };
}

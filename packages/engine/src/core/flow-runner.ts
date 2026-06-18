import type { GraphJson } from "@zaa-tool/shared";
import { EventEmitter } from "node:events";
import { Scope } from "./scope.js";
import { GraphAnalyzer } from "./graph-analyzer.js";
import { defaultExecutorRegistry } from "./registry.js";
import { getReachableNodes } from "./graph-traversal.js";
import { executeNode } from "./node-executor.js";
import { initializeScopeFromGraph } from "./scope-initializer.js";
import type { ExecutorRegistry } from "./types.js";

export async function runFlow(
  graph: GraphJson,
  ee?: EventEmitter,
  startNodeId?: string,
  registry: ExecutorRegistry = defaultExecutorRegistry
) {
  const flowStartTime = Date.now();
  const order = GraphAnalyzer.topoSort(graph);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const loopBodyNodeIds = GraphAnalyzer.getAllLoopBodyNodes(graph);

  const globalScope = new Scope();
  initializeScopeFromGraph(graph, globalScope);

  const activeEdges = new Set<string>();
  const reachableNodes = startNodeId ? getReachableNodes(graph, startNodeId) : null;

  async function runSubFlow(nodeIds: string[], scope: Scope) {
    const subOrder = order.filter((id) => nodeIds.includes(id));
    const subActiveEdges = new Set<string>();

    for (const nodeId of subOrder) {
      if (reachableNodes && !reachableNodes.has(nodeId)) continue;

      const node = nodeMap.get(nodeId)!;
      const incomingEdges = graph.edges.filter((e) => e.target === nodeId);

      const isRunnable =
        nodeId === startNodeId ||
        incomingEdges.length === 0 ||
        incomingEdges.some((e) => {
          const isSourceOutside = !nodeIds.includes(e.source);
          return isSourceOutside || subActiveEdges.has(e.id);
        });

      if (!isRunnable) {
        console.log(`  [${nodeId}] ${node.data.label} (Skipped: inputs not active in sub-flow)`);
        continue;
      }

      const result = await executeNode({ nodeId, nodeMap, graph, scope, activeEdges: subActiveEdges, startNodeId, runSubFlow, ee, registry });
      if (!result.success) {
        throw new Error(`Error executing node ${nodeId}: ${result.error}`);
      }
    }
  }

  for (const nodeId of order) {
    if (loopBodyNodeIds.has(nodeId)) continue;
    if (reachableNodes && !reachableNodes.has(nodeId)) continue;

    const node = nodeMap.get(nodeId)!;
    const incomingEdges = graph.edges.filter((e) => e.target === nodeId);

    const isRunnable =
      nodeId === startNodeId ||
      (!startNodeId && incomingEdges.length === 0) ||
      incomingEdges.some((e) => activeEdges.has(e.id));

    if (!isRunnable) {
      console.log(`\n▶ [${nodeId}] ${node.data.label} (SKIPPED: path not active)`);
      continue;
    }

    const result = await executeNode({ nodeId, nodeMap, graph, scope: globalScope, activeEdges, startNodeId, runSubFlow, ee, registry });
    if (!result.success) {
      console.error(`  ❌ ERROR: ${result.error}`);
      break;
    }
  }

  console.log("\n🏁 Flow finished.");
  ee?.emit("flow:done", { type: "flow:done", ms: Date.now() - flowStartTime });
}

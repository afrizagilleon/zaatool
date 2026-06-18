import type { GraphJson } from "@zaa-tool/shared";
import { EventEmitter } from "node:events";
import { Scope } from "./scope.js";
import { GraphAnalyzer } from "./graph-analyzer.js";
import { defaultExecutorRegistry } from "./registry.js";
import { JsCodeExecutor } from "../executors/js.executor.js";
import { PythonCodeExecutor } from "../executors/python.executor.js";
import { IfExecutor } from "../executors/if.executor.js";
import { LoopExecutor } from "../executors/loop.executor.js";
import { PassthroughExecutor } from "../executors/ui.executor.js";
import { storageService } from "../services/storage.service.js";
import { getReachableNodes } from "./graph-traversal.js";
import { executeNode } from "./node-executor.js";

// Register default executors (Open-Closed extension entry)
if (!defaultExecutorRegistry.has("code:node")) {
  defaultExecutorRegistry.set("code:node", new JsCodeExecutor());
}
if (!defaultExecutorRegistry.has("code:python")) {
  defaultExecutorRegistry.set("code:python", new PythonCodeExecutor());
}
if (!defaultExecutorRegistry.has("if")) {
  defaultExecutorRegistry.set("if", new IfExecutor());
}
if (!defaultExecutorRegistry.has("loop")) {
  defaultExecutorRegistry.set("loop", new LoopExecutor());
}
if (!defaultExecutorRegistry.has("ui:input")) {
  const uiExecutor = new PassthroughExecutor();
  defaultExecutorRegistry.set("ui:input", uiExecutor);
  defaultExecutorRegistry.set("ui:table", uiExecutor);
  defaultExecutorRegistry.set("ui:chart", uiExecutor);
  defaultExecutorRegistry.set("ui:text", uiExecutor);
  defaultExecutorRegistry.set("ui:image", uiExecutor);
  defaultExecutorRegistry.set("file", uiExecutor);
  defaultExecutorRegistry.set("trigger:start", uiExecutor);
  defaultExecutorRegistry.set("trigger:cron", uiExecutor);
}

export async function runFlow(graph: GraphJson, ee?: EventEmitter, startNodeId?: string) {
  const flowStartTime = Date.now();
  const order = GraphAnalyzer.topoSort(graph);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // Identify all nodes that belong to any loop body
  const loopBodyNodeIds = GraphAnalyzer.getAllLoopBodyNodes(graph);

  // Root output scope
  const globalScope = new Scope();

  // Pre-populate scope with cached outputs (caching/checkpoints)
  for (const node of graph.nodes) {
    if (node.data.outputs) {
      globalScope.set(node.id, node.data.outputs);
    }
  }

  // Pre-populate scope with static UI/data nodes' output values
  for (const node of graph.nodes) {
    if (node.type === "ui:input") {
      globalScope.set(node.id, { values: node.data.values || {} });
    } else if (node.type === "file") {
      const filePath = node.data.inputs?.file;
      globalScope.set(node.id, {
        file: filePath ? {
          name: filePath.split("/").pop() || filePath,
          path: filePath,
          url: filePath,
          absolute_path: storageService.resolvePath("", filePath),
        } : null
      });
    } else if (node.type === "ui:table") {
      globalScope.set(node.id, { selectedRow: node.data.selectedRow || null });
    }
  }

  // Track active edges
  const activeEdges = new Set<string>();

  // If startNodeId is provided, find reachable nodes downstream
  const reachableNodes = startNodeId ? getReachableNodes(graph, startNodeId) : null;

  /**
   * Sub-flow runner function passed to loop executors.
   * Executes a list of target node IDs inside a specific Scope.
   */
  async function runSubFlow(nodeIds: string[], scope: Scope) {
    // Keep the relative topological order from the main graph sort
    const subOrder = order.filter((id) => nodeIds.includes(id));
    const subActiveEdges = new Set<string>();

    for (const nodeId of subOrder) {
      if (reachableNodes && !reachableNodes.has(nodeId)) {
        continue;
      }

      const node = nodeMap.get(nodeId)!;
      const incomingEdges = graph.edges.filter((e) => e.target === nodeId);

      // A sub-flow node is runnable if:
      // 1. It has no incoming edges.
      // 2. Or at least one of its incoming edges from within the sub-flow is active.
      // 3. Or it has incoming edges from outside the sub-flow (which are active by default)
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

      const result = await executeNode({
        nodeId,
        nodeMap,
        graph,
        scope,
        activeEdges: subActiveEdges,
        startNodeId,
        runSubFlow,
        ee,
      });

      if (!result.success) {
        throw new Error(`Error executing node ${nodeId}: ${result.error}`);
      }
    }
  }

  // Main/outer flow execution
  for (const nodeId of order) {
    // Exclude loop body nodes; they are run only inside the LoopExecutor
    if (loopBodyNodeIds.has(nodeId)) {
      continue;
    }

    // Filter by reachability if running from a specific node
    if (reachableNodes && !reachableNodes.has(nodeId)) {
      continue;
    }

    const node = nodeMap.get(nodeId)!;
    const incomingEdges = graph.edges.filter((e) => e.target === nodeId);

    // A node is runnable at the outer level if:
    // 1. It is the start node.
    // 2. Or it has no incoming edges (only when not restricted by startNodeId).
    // 3. Or at least one of its incoming edges is active.
    const isRunnable =
      nodeId === startNodeId ||
      (!startNodeId && incomingEdges.length === 0) ||
      incomingEdges.some((e) => activeEdges.has(e.id));

    if (!isRunnable) {
      console.log(`\n▶ [${nodeId}] ${node.data.label} (SKIPPED: path not active)`);
      continue;
    }

    const result = await executeNode({
      nodeId,
      nodeMap,
      graph,
      scope: globalScope,
      activeEdges,
      startNodeId,
      runSubFlow,
      ee,
    });

    if (!result.success) {
      console.error(`  ❌ ERROR: ${result.error}`);
      break;
    }
  }

  console.log("\n🏁 Flow finished.");
  ee?.emit("flow:done", { type: "flow:done", ms: Date.now() - flowStartTime });
}

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
import { inferSchema } from "../utils/infer-schema.js";

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
  defaultExecutorRegistry.set("ui:text", uiExecutor);
  defaultExecutorRegistry.set("ui:image", uiExecutor);
  defaultExecutorRegistry.set("file", uiExecutor);
}

function getReachableNodes(graph: GraphJson, startNodeId: string): Set<string> {
  const reachable = new Set<string>([startNodeId]);
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const outgoing = graph.edges.filter((e) => e.source === current);
    for (const edge of outgoing) {
      if (!reachable.has(edge.target)) {
        reachable.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return reachable;
}

export async function runFlow(graph: GraphJson, ee?: EventEmitter, startNodeId?: string) {
  const flowStartTime = Date.now();
  const order = GraphAnalyzer.topoSort(graph);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // Identify all nodes that belong to any loop body
  const loopBodyNodeIds = GraphAnalyzer.getAllLoopBodyNodes(graph);

  // Root output scope
  const globalScope = new Scope();

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
      // If we are executing a subset of the graph, check reachability
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

      // Collect inputs from the scope chain
      const inputs: Record<string, unknown> = {};
      for (const edge of incomingEdges) {
        const sourceOutput = scope.get(edge.source) ?? {};
        inputs[edge.targetHandle] = sourceOutput[edge.sourceHandle];
      }

      console.log(`\n▶ [${nodeId}] ${node.data.label} (Sub-Flow)`);
      console.log(`  inputs:`, inputs);

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
        throw new Error(`Error executing node ${nodeId}: ${result.error}`);
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

      // Propagate active status to outgoing edges
      for (const edge of graph.edges.filter((e) => e.source === nodeId)) {
        const isActive =
          (!result.activeHandle && !result.activeHandles) ||
          (result.activeHandle && edge.sourceHandle === result.activeHandle) ||
          (result.activeHandles && result.activeHandles.includes(edge.sourceHandle));

        if (isActive) {
          subActiveEdges.add(edge.id);
        }
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

    // Collect inputs
    const inputs: Record<string, unknown> = {};
    for (const edge of incomingEdges) {
      if (!startNodeId || activeEdges.has(edge.id)) {
        const sourceOutput = globalScope.get(edge.source) ?? {};
        inputs[edge.targetHandle] = sourceOutput[edge.sourceHandle];
      }
    }

    console.log(`\n▶ [${nodeId}] ${node.data.label}`);
    console.log(`  inputs:`, inputs);

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
      scope: globalScope,
      runSubFlow,
      ee,
    });

    if (result.error) {
      ee?.emit("node:error", { type: "node:error", nodeId, error: result.error, stack: "" });
      console.error(`  ❌ ERROR: ${result.error}`);
      break;
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

    globalScope.set(nodeId, result.output ?? {});

    // Propagate active status to outgoing edges
    for (const edge of graph.edges.filter((e) => e.source === nodeId)) {
      const isActive =
        (!result.activeHandle && !result.activeHandles) ||
        (result.activeHandle && edge.sourceHandle === result.activeHandle) ||
        (result.activeHandles && result.activeHandles.includes(edge.sourceHandle));

      if (isActive) {
        activeEdges.add(edge.id);
      }
    }
  }

  console.log("\n🏁 Flow finished.");
  ee?.emit("flow:done", { type: "flow:done", ms: Date.now() - flowStartTime });
}

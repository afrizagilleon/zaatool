import type { GraphJson, EdgeDef } from "@zaa-tool/shared";
import { EventEmitter } from "node:events";
import { topoSort } from "./topological-sort.js";
import { Scope, executorRegistry } from "./executor.js";
import { JsCodeExecutor } from "./executors/code-js.js";
import { PythonCodeExecutor } from "./executors/code-python.js";
import { IfExecutor } from "./executors/if.js";
import { LoopExecutor } from "./executors/loop.js";

// Register the executors to allow open-closed extension
executorRegistry.set("code:node", new JsCodeExecutor());
executorRegistry.set("code:python", new PythonCodeExecutor());
executorRegistry.set("if", new IfExecutor());
executorRegistry.set("loop", new LoopExecutor());

/**
 * Traverses downstream starting from target of matching edges to identify all nodes in the body.
 */
function getReachableNodes(graph: GraphJson, startEdges: EdgeDef[]): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = startEdges.map(e => e.target);

    for (const target of queue) {
        visited.add(target);
    }

    while (queue.length > 0) {
        const current = queue.shift()!;
        const nextEdges = graph.edges.filter(e => e.source === current);
        for (const edge of nextEdges) {
            if (!visited.has(edge.target)) {
                visited.add(edge.target);
                queue.push(edge.target);
            }
        }
    }
    return visited;
}

export async function runFlow(graph: GraphJson, ee?: EventEmitter) {
    const flowStartTime = Date.now();
    const order = topoSort(graph);
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    // Identify all nodes that belong to any loop body to exclude them from the outer main execution loop
    const loopBodyNodeIds = new Set<string>();
    for (const node of graph.nodes) {
        if (node.type === "loop") {
            const bodyStartEdges = graph.edges.filter(
                e => e.source === node.id && (e.sourceHandle === "body" || e.sourceHandle === "item" || e.sourceHandle === "element")
            );
            const bodyNodes = getReachableNodes(graph, bodyStartEdges);

            const exitStartEdges = graph.edges.filter(
                e => e.source === node.id && (e.sourceHandle === "output" || e.sourceHandle === "exit" || e.sourceHandle === "done" || e.sourceHandle === "completed")
            );
            const exitNodes = getReachableNodes(graph, exitStartEdges);

            for (const id of bodyNodes) {
                if (!exitNodes.has(id) && id !== node.id) {
                    loopBodyNodeIds.add(id);
                }
            }
        }
    }

    // Root output scope
    const globalScope = new Scope();

    // Track active edges
    const activeEdges = new Set<string>();

    /**
     * Sub-flow runner function passed to loop executors.
     * Executes a list of target node IDs inside a specific Scope.
     */
    async function runSubFlow(nodeIds: string[], scope: Scope) {
        // Keep the relative topological order from the main graph sort
        const subOrder = order.filter(id => nodeIds.includes(id));
        const subActiveEdges = new Set<string>();

        for (const nodeId of subOrder) {
            const node = nodeMap.get(nodeId)!;
            const incomingEdges = graph.edges.filter(e => e.target === nodeId);

            // A sub-flow node is runnable if:
            // 1. It has no incoming edges.
            // 2. Or at least one of its incoming edges from within the sub-flow is active.
            // 3. Or it has incoming edges from outside the sub-flow (which are active by default)
            const isRunnable = incomingEdges.length === 0 || incomingEdges.some(e => {
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
            const executor = executorRegistry.get(key);
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
                ee
            });

            if (result.error) {
                ee?.emit("node:error", { type: "node:error", nodeId, error: result.error, stack: "" });
                throw new Error(`Error executing node ${nodeId}: ${result.error}`);
            }

            ee?.emit("node:done", { 
                type: "node:done", 
                nodeId, 
                output: result.output ?? {}, 
                ms: Date.now() - startTime,
                activeHandle: result.activeHandle,
                activeHandles: result.activeHandles
            });

            scope.set(nodeId, result.output ?? {});

            // Propagate active status to outgoing edges
            for (const edge of graph.edges.filter(e => e.source === nodeId)) {
                const isActive = !result.activeHandle && !result.activeHandles
                    || (result.activeHandle && edge.sourceHandle === result.activeHandle)
                    || (result.activeHandles && result.activeHandles.includes(edge.sourceHandle));

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

        const node = nodeMap.get(nodeId)!;
        const incomingEdges = graph.edges.filter(e => e.target === nodeId);

        // A node is runnable at the outer level if:
        // 1. It has no incoming edges.
        // 2. Or at least one of its incoming edges is active.
        const isRunnable = incomingEdges.length === 0 || incomingEdges.some(e => activeEdges.has(e.id));

        if (!isRunnable) {
            console.log(`\n▶ [${nodeId}] ${node.data.label} (SKIPPED: path not active)`);
            continue;
        }

        // Collect inputs
        const inputs: Record<string, unknown> = {};
        for (const edge of incomingEdges) {
            if (activeEdges.has(edge.id)) {
                const sourceOutput = globalScope.get(edge.source) ?? {};
                inputs[edge.targetHandle] = sourceOutput[edge.sourceHandle];
            }
        }

        console.log(`\n▶ [${nodeId}] ${node.data.label}`);
        console.log(`  inputs:`, inputs);

        const key = node.type === "code" && node.runtime ? `${node.type}:${node.runtime}` : node.type;
        const executor = executorRegistry.get(key);
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
            ee
        });

        if (result.error) {
            ee?.emit("node:error", { type: "node:error", nodeId, error: result.error, stack: "" });
            console.error(`  ❌ ERROR: ${result.error}`);
            break;
        }

        ee?.emit("node:done", { 
            type: "node:done", 
            nodeId, 
            output: result.output ?? {}, 
            ms: Date.now() - startTime,
            activeHandle: result.activeHandle,
            activeHandles: result.activeHandles
        });

        globalScope.set(nodeId, result.output ?? {});

        // Propagate active status to outgoing edges
        for (const edge of graph.edges.filter(e => e.source === nodeId)) {
            const isActive = !result.activeHandle && !result.activeHandles
                || (result.activeHandle && edge.sourceHandle === result.activeHandle)
                || (result.activeHandles && result.activeHandles.includes(edge.sourceHandle));

            if (isActive) {
                activeEdges.add(edge.id);
            }
        }
    }

    console.log("\n🏁 Flow finished.");
    ee?.emit("flow:done", { type: "flow:done", ms: Date.now() - flowStartTime });
}
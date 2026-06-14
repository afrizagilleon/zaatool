import { NodeExecutor, NodeExecutorContext, NodeExecutorResult, Scope } from "../executor.js";
import type { EdgeDef, GraphJson } from "@zaa-tool/shared";

/**
 * Traverses downstream starting from the target of matching edges.
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

export class LoopExecutor implements NodeExecutor {
    async execute(context: NodeExecutorContext): Promise<NodeExecutorResult> {
        const { node, inputs, graph, scope, runSubFlow } = context;

        // 1. Try to find the array to loop over
        let arrayToLoop: unknown[] = [];
        if (Array.isArray(inputs.list)) {
            arrayToLoop = inputs.list;
        } else if (Array.isArray(inputs.array)) {
            arrayToLoop = inputs.array;
        } else if (Array.isArray(inputs.input)) {
            arrayToLoop = inputs.input;
        } else {
            const foundArray = Object.values(inputs).find(val => Array.isArray(val));
            if (Array.isArray(foundArray)) {
                arrayToLoop = foundArray;
            }
        }

        console.log(`  Loop array to process:`, arrayToLoop);

        // 2. Identify the loop body nodes
        // Downstream from "body" or "item" source handles
        const bodyStartEdges = graph.edges.filter(
            e => e.source === node.id && (e.sourceHandle === "body" || e.sourceHandle === "item" || e.sourceHandle === "element")
        );
        const bodyNodes = getReachableNodes(graph, bodyStartEdges);

        // Downstream from exit handles (e.g. "output", "done", "exit")
        const exitStartEdges = graph.edges.filter(
            e => e.source === node.id && (e.sourceHandle === "output" || e.sourceHandle === "exit" || e.sourceHandle === "done" || e.sourceHandle === "completed")
        );
        const exitNodes = getReachableNodes(graph, exitStartEdges);

        // Loop body consists of nodes reachable from body start edges, but NOT exit paths or the loop node itself
        const loopBodyNodeIds = new Set<string>();
        for (const id of bodyNodes) {
            if (!exitNodes.has(id) && id !== node.id) {
                loopBodyNodeIds.add(id);
            }
        }

        const bodyNodeIdsList = Array.from(loopBodyNodeIds);
        console.log(`  Loop body node IDs:`, bodyNodeIdsList);

        // 3. Execute the body for each item
        for (let i = 0; i < arrayToLoop.length; i++) {
            const currentItem = arrayToLoop[i];
            console.log(`\n--- Loop Iteration ${i + 1}/${arrayToLoop.length} (item: ${JSON.stringify(currentItem)}) ---`);

            // Create a local scope for this iteration
            const childScope = new Scope(scope);
            // Set loop node outputs in the child scope
            childScope.set(node.id, { element: currentItem, item: currentItem });

            // Run the sub-flow with the child scope
            await runSubFlow(bodyNodeIdsList, childScope);
        }

        console.log(`\n--- Loop Completed ---`);

        // Activate the exit paths of the loop node
        const exitHandles = ["output", "exit", "done", "completed"];
        return {
            output: {},
            activeHandles: exitHandles
        };
    }
}

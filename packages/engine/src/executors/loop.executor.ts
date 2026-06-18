import { NodeExecutor, NodeExecutorContext, NodeExecutorResult, Scope } from "../core/types.js";
import { GraphAnalyzer } from "../core/graph-analyzer.js";
import { truncateLog } from "../core/utils.js";

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
      const foundArray = Object.values(inputs).find((val) => Array.isArray(val));
      if (Array.isArray(foundArray)) {
        arrayToLoop = foundArray;
      }
    }

    console.log(`  Loop array to process:`, truncateLog(arrayToLoop));

    // 2. Identify the loop body nodes using GraphAnalyzer
    const loopBodyNodeIds = GraphAnalyzer.getLoopBodyNodes(graph, node.id);
    const bodyNodeIdsList = Array.from(loopBodyNodeIds);
    console.log(`  Loop body node IDs:`, bodyNodeIdsList);

    // 3. Execute the body for each item
    for (let i = 0; i < arrayToLoop.length; i++) {
      const currentItem = arrayToLoop[i];
      console.log(`\n--- Loop Iteration ${i + 1}/${arrayToLoop.length} (item: ${truncateLog(currentItem, 150)}) ---`);

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
      activeHandles: exitHandles,
    };
  }
}

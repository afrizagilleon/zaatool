import { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../executor.js";
import { runJsNode } from "../js-runner.js";

export class IfExecutor implements NodeExecutor {
    async execute(context: NodeExecutorContext): Promise<NodeExecutorResult> {
        const { node, inputs } = context;
        const code = node.data.code ?? "";
        const timeout = (node.data.config?.timeout as number) ?? 5000;

        const result = await runJsNode(code, inputs, timeout);

        result.logs.forEach(l => console.log(`  [${l.level}] ${l.msg}`));

        if (result.error) {
            console.error(`  ❌ ERROR: ${result.error}`);
            return { error: result.error };
        }

        const conditionTrue = Boolean(result.output?.condition);
        const activeHandle = conditionTrue ? "true" : "false";
        console.log(`  ✅ If condition evaluated to ${conditionTrue}. Active handle: ${activeHandle}`);

        return {
            output: result.output ?? {},
            activeHandle
        };
    }
}

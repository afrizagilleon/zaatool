import { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../executor.js";
import { runPythonNode } from "../python-runner.js";

export class PythonCodeExecutor implements NodeExecutor {
    async execute(context: NodeExecutorContext): Promise<NodeExecutorResult> {
        const { node, inputs } = context;
        const code = node.data.code ?? "";
        const timeout = (node.data.config?.timeout as number) ?? 5000;

        const result = await runPythonNode(code, inputs, timeout, (level, msg) => {
            context.ee?.emit("node:log", { type: "node:log", nodeId: node.id, level, payload: msg });
        });

        result.logs.forEach(l => console.log(`  [${l.level}] ${l.msg}`));

        if (result.error) {
            console.error(`  ❌ ERROR: ${result.error}`);
            return { error: result.error };
        }

        console.log(`  ✅ output (${result.ms}ms):`, result.output);
        return { output: result.output ?? {} };
    }
}

import { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../executor.js";
import { runJsNode } from "../js-runner.js";

export class IfExecutor implements NodeExecutor {
    async execute(context: NodeExecutorContext): Promise<NodeExecutorResult> {
        const { node, inputs } = context;
        const code = node.data.code ?? "";
        const timeout = (node.data.config?.timeout as number) ?? 5000;

        const result = await runJsNode(code, inputs, timeout, (level, msg) => {
            context.ee?.emit("node:log", { type: "node:log", nodeId: node.id, level, payload: msg });
        });

        result.logs.forEach(l => console.log(`  [${l.level}] ${l.msg}`));

        if (result.error) {
            console.error(`  ❌ ERROR: ${result.error}`);
            return { error: result.error };
        }

        let activeHandle: string;
        if (typeof result.output === "object" && result.output !== null && "condition" in result.output) {
            // Legacy/fallback: if it returns {condition: true}
            activeHandle = result.output.condition ? "true" : "false";
        } else if (typeof result.output === "boolean") {
            // If it returns true/false directly
            activeHandle = result.output ? "true" : "false";
        } else if (typeof result.output === "string") {
            // Multi-branch: return exact handle name
            activeHandle = result.output;
        } else {
            // Default fallback
            activeHandle = Boolean(result.output) ? "true" : "false";
        }

        console.log(`  ✅ If condition evaluated. Active handle: ${activeHandle}`);

        return {
            output: typeof result.output === "object" ? result.output : { result: result.output },
            activeHandle
        };
    }
}

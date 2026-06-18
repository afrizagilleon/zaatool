import { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../core/types.js";
import { runJsNode } from "../core/js-runner.js";
import { secretsService } from "../services/secrets.service.js";
import { truncateLog } from "../core/utils.js";

export class JsCodeExecutor implements NodeExecutor {
  async execute(context: NodeExecutorContext): Promise<NodeExecutorResult> {
    const { node, inputs } = context;
    const code = node.data.code ?? "";
    const timeout = (node.data.config?.timeout as number) ?? 5000;

    const rawSecrets = await secretsService.getRawSecrets();
    const result = await runJsNode(
      code,
      inputs,
      timeout,
      (level, msg) => {
        context.ee?.emit("node:log", { type: "node:log", nodeId: node.id, level, payload: msg });
      },
      rawSecrets,
      node.data.inputsSchema || []
    );

    result.logs.forEach((l) => console.log(`  [${l.level}] ${l.msg}`));

    if (result.error) {
      console.error(`  ❌ ERROR: ${result.error}`);
      return { error: result.error };
    }

    console.log(`  ✅ output (${result.ms}ms):`, truncateLog(result.output));
    return { output: result.output ?? {} };
  }
}

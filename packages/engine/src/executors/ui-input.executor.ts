import type { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../core/types.js";

export class UiInputExecutor implements NodeExecutor {
  async execute({ node }: NodeExecutorContext): Promise<NodeExecutorResult> {
    return { output: { values: node.data.values || {} } };
  }
}

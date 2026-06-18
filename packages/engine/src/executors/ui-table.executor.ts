import type { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../core/types.js";

export class UiTableExecutor implements NodeExecutor {
  async execute({ node }: NodeExecutorContext): Promise<NodeExecutorResult> {
    return {
      output: { selectedRow: node.data.selectedRow ?? null },
    };
  }
}

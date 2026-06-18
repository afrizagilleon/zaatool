import type { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../core/types.js";

export class UiInputExecutor implements NodeExecutor {
  async execute({ node, inputs }: NodeExecutorContext): Promise<NodeExecutorResult> {
    const mergedValues: Record<string, unknown> = { ...(node.data.values || {}) };
    for (const [key, val] of Object.entries(inputs)) {
      if (key.startsWith("value_")) {
        const fieldId = key.replace("value_", "");
        mergedValues[fieldId] = val;
      }
    }
    return { output: { values: mergedValues } };
  }
}

import type { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../core/types.js";

/**
 * Generic passthrough for UI display nodes (ui:text, ui:image, ui:chart, triggers).
 * These nodes forward their inputs as outputs without transformation.
 * Type-specific UI nodes (ui:input, file, ui:table) have their own dedicated executors.
 */
export class PassthroughExecutor implements NodeExecutor {
  async execute({ inputs }: NodeExecutorContext): Promise<NodeExecutorResult> {
    return { output: inputs };
  }
}

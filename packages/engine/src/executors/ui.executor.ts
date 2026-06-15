import type { NodeExecutorContext, NodeExecutor, NodeExecutorResult } from "../core/types.js";

/**
 * A generic executor for UI nodes that just passes through its inputs to outputs.
 * In the engine context, UI nodes don't have interactive behavior, they are mostly
 * data placeholders or passthroughs.
 */
export class PassthroughExecutor implements NodeExecutor {
  async execute({ node, inputs }: NodeExecutorContext): Promise<NodeExecutorResult> {
    if (node.type === "ui:input") {
      return {
        output: {
          values: node.data.values || {},
        },
      };
    }

    if (node.type === "file") {
      const filePath = node.data.inputs?.file;
      return {
        output: {
          file: filePath ? {
            name: filePath.split("/").pop() || filePath,
            path: filePath,
            url: filePath,
          } : null,
        },
      };
    }

    if (node.type === "ui:table") {
      return {
        output: {
          selectedRow: node.data.selectedRow || null,
        },
      };
    }

    // Default passthrough behavior (ui:text, ui:image, etc.)
    return {
      output: inputs,
    };
  }
}

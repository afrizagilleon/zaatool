import type { NodeExecutorContext, NodeExecutor, NodeExecutorResult } from "../core/types.js";
import { storageService } from "../services/storage.service.js";

/**
 * A generic executor for UI nodes that just passes through its inputs to outputs.
 * In the engine context, UI nodes don't have interactive behavior, they are mostly
 * data placeholders or passthroughs.
 */
export class PassthroughExecutor implements NodeExecutor {
  async execute({ node, inputs }: NodeExecutorContext): Promise<NodeExecutorResult> {
    if (node.type === "ui:input") {
      const mergedValues = { ...(node.data.values || {}) };
      if (inputs) {
        for (const [key, val] of Object.entries(inputs)) {
          if (key.startsWith("value_")) {
            const fieldId = key.replace("value_", "");
            mergedValues[fieldId] = val;
          }
        }
      }
      return {
        output: {
          values: mergedValues,
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
            absolute_path: storageService.resolvePath("", filePath),
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

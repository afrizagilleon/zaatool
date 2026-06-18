import type { NodeExecutor, NodeExecutorContext, NodeExecutorResult } from "../core/types.js";
import { storageService } from "../services/storage.service.js";

export class FileExecutor implements NodeExecutor {
  async execute({ node }: NodeExecutorContext): Promise<NodeExecutorResult> {
    const filePath = node.data.inputs?.file as string | undefined;
    return {
      output: {
        file: filePath
          ? {
              name: filePath.split("/").pop() || filePath,
              path: filePath,
              url: filePath,
              absolute_path: storageService.resolvePath("", filePath),
            }
          : null,
      },
    };
  }
}

import { NodeExecutor, ExecutorRegistry } from "./types.js";

export class NodeExecutorRegistry implements ExecutorRegistry {
  private executors = new Map<string, NodeExecutor>();

  get(key: string): NodeExecutor | undefined {
    return this.executors.get(key);
  }

  set(key: string, executor: NodeExecutor): void {
    this.executors.set(key, executor);
  }

  has(key: string): boolean {
    return this.executors.has(key);
  }
}

// Global default registry instance to preserve previous imports if needed
export const defaultExecutorRegistry = new NodeExecutorRegistry();

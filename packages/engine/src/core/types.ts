import type { GraphJson, NodeDef } from "@zaa-tool/shared";
import { EventEmitter } from "node:events";
import { Scope } from "./scope.js";
export { Scope };

export interface NodeExecutorContext {
  node: NodeDef;
  inputs: Record<string, unknown>;
  graph: GraphJson;
  scope: Scope;
  runSubFlow: (nodeIds: string[], scope: Scope) => Promise<void>;
  ee?: EventEmitter;
}

export interface NodeExecutorResult {
  output?: Record<string, unknown>;
  error?: string;
  activeHandle?: string; // e.g. "true" or "false" for an "if" node
  activeHandles?: string[]; // Custom list of active handles for loop or other nodes
}

export interface NodeExecutor {
  execute(context: NodeExecutorContext): Promise<NodeExecutorResult>;
}

export interface ExecutorRegistry {
  get(key: string): NodeExecutor | undefined;
  set(key: string, executor: NodeExecutor): void;
  has(key: string): boolean;
}

import type { GraphJson, NodeDef } from "@zaa-tool/shared";
import { EventEmitter } from "node:events";

/**
 * Class representing scoped output values, supporting nested scoping for loops/sub-flows.
 */
export class Scope {
    constructor(
        public parent?: Scope,
        private values = new Map<string, Record<string, unknown>>()
    ) {}

    /**
     * Get value from current scope or parent scope recursively.
     */
    get(nodeId: string): Record<string, unknown> | undefined {
        if (this.values.has(nodeId)) {
            return this.values.get(nodeId);
        }
        return this.parent?.get(nodeId);
    }

    /**
     * Set output value for a node in the current scope.
     */
    set(nodeId: string, val: Record<string, unknown>) {
        this.values.set(nodeId, val);
    }
}

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

export const executorRegistry = new Map<string, NodeExecutor>();

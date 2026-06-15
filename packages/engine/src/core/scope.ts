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

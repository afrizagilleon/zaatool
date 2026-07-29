/**
 * Variable scope for a notebook run.
 *
 * Cells share one namespace: whatever a cell returns is merged in by name and
 * every later cell reads it. A lane of a parallel step gets a child scope, so it
 * sees the shared state but its own writes stay local until the join.
 *
 * Distinct from `Scope` in scope.ts, which maps node id → that node's outputs
 * for graph runs. Here the key is a variable name.
 */
export class NotebookScope {
  private values = new Map<string, unknown>();

  constructor(private readonly parent?: NotebookScope) {}

  get(name: string): unknown {
    if (this.values.has(name)) return this.values.get(name);
    return this.parent?.get(name);
  }

  has(name: string): boolean {
    return this.values.has(name) || (this.parent?.has(name) ?? false);
  }

  set(name: string, value: unknown): void {
    this.values.set(name, value);
  }

  /** Merges a cell's returned record. Anything that is not an object writes nothing. */
  merge(returned: unknown): string[] {
    if (returned === null || typeof returned !== "object" || Array.isArray(returned)) {
      return [];
    }
    const names = Object.keys(returned as Record<string, unknown>);
    for (const name of names) {
      this.values.set(name, (returned as Record<string, unknown>)[name]);
    }
    return names;
  }

  /** Names written in this scope only, ignoring anything inherited. */
  localEntries(): Map<string, unknown> {
    return new Map(this.values);
  }

  /** Flattened view handed to a cell as its `inputs`, parent values first. */
  snapshot(): Record<string, unknown> {
    const base = this.parent ? this.parent.snapshot() : {};
    for (const [name, value] of this.values) {
      base[name] = value;
    }
    return base;
  }
}

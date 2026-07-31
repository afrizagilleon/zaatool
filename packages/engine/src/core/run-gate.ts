/**
 * Bounds how many notebook runs execute at once.
 *
 * Each running cell costs a worker thread or a Python process, so without a bound a
 * burst of triggers — a webhook hit in a loop, several crons landing on the same
 * minute — would spawn as many as arrive until the machine gives out. Triggers are
 * what make that reachable from outside, so the bound ships with them.
 *
 * Runs beyond the limit wait; runs beyond the queue are refused, because a queue that
 * grows without limit is the same failure one step removed.
 */
export class RunGate {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number
  ) {}

  get stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiting.length };
  }

  /** True when the gate would refuse another run right now. */
  isFull(): boolean {
    return this.active >= this.maxConcurrent && this.waiting.length >= this.maxQueued;
  }

  /**
   * Resolves once a slot is free. The returned function must be called when the run
   * finishes — always, including on failure — or the slot is never given back.
   */
  async acquire(): Promise<() => void> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    this.active += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

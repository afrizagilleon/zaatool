/**
 * Counts attempts per key inside a sliding window, in memory.
 *
 * Synchronous on purpose. A counter that is read, then awaited on, then written lets a burst
 * of parallel requests all read "room left": `reserve` takes its place in the count in the
 * same step it checks it, so a hundred requests arriving together are a hundred increments,
 * not a hundred identical readings. Lost on restart, which is the right failure for a
 * throttle: the durable record of anything worth keeping lives in the database.
 */
export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    /** How many attempts a key may make per window; read at each call so it can follow the environment. */
    private readonly limit: () => number,
    private readonly windowMs: () => number
  ) {}

  /**
   * Counts one attempt. Returns how many the key has made in the window, this one included;
   * the caller compares it with the limit it cares about, so one counter can serve a
   * soft limit and a hard ceiling.
   */
  count(key: string): number {
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((at) => now - at < this.windowMs());
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > 10_000) this.sweep(now);
    return recent.length;
  }

  /** Takes one attempt back, for a request that turned out not to be what the limit is for. */
  refund(key: string): void {
    const times = this.attempts.get(key);
    if (!times) return;
    times.pop();
    if (times.length === 0) this.attempts.delete(key);
  }

  /** Counts an attempt and says whether it is within the limit; an attempt over it still counts. */
  reserve(key: string): boolean {
    return this.count(key) <= this.limit();
  }

  /** Seconds until the oldest attempt in the window ages out, for a `Retry-After`. */
  retryAfterSeconds(key: string): number {
    const oldest = this.attempts.get(key)?.[0];
    if (oldest === undefined) return 1;
    return Math.max(1, Math.ceil((oldest + this.windowMs() - Date.now()) / 1000));
  }

  /** Forgets keys whose every attempt has aged out, so the map does not grow with every address seen. */
  private sweep(now: number): void {
    for (const [key, times] of this.attempts) {
      if (times.every((at) => now - at >= this.windowMs())) this.attempts.delete(key);
    }
  }
}

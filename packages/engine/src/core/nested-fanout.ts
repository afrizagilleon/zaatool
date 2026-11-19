import { abortMessage } from "./run-abort.js";

/**
 * Bounds the `notebooks.run` calls one root run makes.
 *
 * Nested calls do not pass through the run gate (the caller already holds a slot and is
 * blocked on them), so without a bound of their own one cell could spawn a worker or a
 * Python process per call: `Promise.all` of 1000 calls is 1000 of them. Two limits, both
 * per root run:
 *
 *  - how many calls EXECUTE at once; the rest wait their turn;
 *  - how many calls the run may make in all; the next one is refused, in the cell.
 *
 * A run that is itself waiting on a call it made gives its place back for the duration
 * (`Slot.yieldSlot`). Otherwise four callees, each waiting on a callee of its own, would
 * hold every place and wait on one another forever. A place therefore means "a run that is
 * actually executing cells", which is what costs a worker.
 */
export class FanOut {
  private active = 0;
  private total = 0;
  private waiting: { grant: () => void; reject: (err: Error) => void }[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxTotal: number
  ) {}

  /** Counts one more call, or throws when the run has made all it is allowed to. */
  admit(): void {
    if (this.total >= this.maxTotal) {
      throw new Error(
        `A run may make at most ${this.maxTotal} nested notebook calls; ` +
          `call ${this.maxTotal + 1} was refused`
      );
    }
    this.total += 1;
  }

  /** Resolves once a place is free. Rejects with the abort reason if the run is stopped first. */
  take(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error(abortMessage(signal)));
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const entry = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = (): void => {
        const index = this.waiting.indexOf(entry);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(new Error(abortMessage(signal!)));
      };
      this.waiting.push(entry);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Hands a place to the next waiter, or frees it. */
  give(): void {
    const next = this.waiting.shift();
    if (next) next.grant();
    else this.active -= 1;
  }
}

/** One nested run's place in a FanOut, which it can lend out while it waits on its own calls. */
export class Slot {
  private held = false;
  private blocked = 0;

  constructor(private readonly fan: FanOut) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    await this.fan.take(signal);
    this.held = true;
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    this.fan.give();
  }

  /** The run is about to wait on a call it made: lend the place out. Pair with `resume`. */
  yieldSlot(): void {
    this.blocked += 1;
    if (this.blocked === 1) this.release();
  }

  /** The call came back: take a place again before the run carries on. */
  async resume(): Promise<void> {
    this.blocked -= 1;
    if (this.blocked === 0) await this.acquire();
  }
}

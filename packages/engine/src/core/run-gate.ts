/**
 * Bounds how many notebook runs execute at once, and how fairly they are shared out.
 *
 * Each running cell costs a process (JavaScript and Python alike), so without a bound a
 * burst of triggers — a webhook hit in a loop, several crons landing on the same
 * minute — would spawn as many as arrive until the machine gives out. Triggers are
 * what make that reachable from outside, so the bound ships with them.
 *
 * Runs beyond the limit wait; runs beyond the queue are refused, because a queue that
 * grows without limit is the same failure one step removed.
 *
 * The bound is also split between owners. One account's notebooks may hold only part of
 * the slots and part of the queue, and a freed slot goes to the owners in turn, so a
 * single webhook hit in a loop cannot make every other account's runs wait or be refused.
 */

export interface RunGateOptions {
  maxConcurrent: number;
  maxQueued: number;
  /**
   * How far the queue may grow for a run that must not be lost (a scheduled one). Beyond
   * `maxQueued` only those are let in, so a burst of webhooks cannot starve a cron, and
   * a queue that grows without limit is still refused.
   */
  maxQueuedScheduled: number;
  /** Slots one owner may hold at once. */
  maxPerOwner: number;
  /** Places in the (webhook-sized) queue one owner may hold; scaled up for scheduled runs. */
  maxQueuedPerOwner: number;
}

/** A place in the gate. Always `release` it — when the run is over, or if it never starts. */
export interface RunTicket {
  /** Resolves once the run holds a running slot. */
  readonly ready: Promise<void>;
  /**
   * Gives the slot back, or the place in line when the run never got a slot. Safe to call
   * twice, and safe to call on a run that was refused later for another reason.
   */
  release(): void;
}

interface Waiting {
  owner: string;
  start: () => void;
}

export class RunGate {
  private active = 0;
  private readonly activeBy = new Map<string, number>();
  /** Waiting runs per owner, oldest first. An owner is present only while it has any. */
  private readonly queues = new Map<string, Waiting[]>();
  /** Owners with a queue, in the order they will next be served. */
  private ring: string[] = [];
  private queued = 0;

  constructor(private readonly options: RunGateOptions) {}

  get stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.queued };
  }

  /**
   * Takes a place for one run, or returns null when the gate would refuse it. A scheduled
   * run is turned away only at the larger bound: a webhook can be retried by whoever sent
   * it, a cron tick cannot, so it waits in line instead.
   *
   * Synchronous on purpose. The check and the reservation are one step, so a burst that
   * arrives together is counted one run at a time — a check followed by a later `await`
   * and a later take would let every one of them through the check.
   */
  reserve(owner: string, scheduled = false): RunTicket | null {
    const { maxConcurrent, maxPerOwner, maxQueued, maxQueuedScheduled, maxQueuedPerOwner } =
      this.options;

    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    // A free slot means every waiting run belongs to an owner at its own limit, so nobody
    // already in line is passed over by a run that starts straight away.
    if (this.active < maxConcurrent && this.heldBy(owner) < maxPerOwner) {
      this.take(owner);
      resolveReady();
      return this.ticket(owner, ready, null);
    }

    const total = scheduled ? maxQueuedScheduled : maxQueued;
    const own = scheduled
      ? Math.ceil((maxQueuedPerOwner * maxQueuedScheduled) / maxQueued)
      : maxQueuedPerOwner;
    if (this.queued >= total || (this.queues.get(owner)?.length ?? 0) >= own) return null;

    const waiting: Waiting = { owner, start: resolveReady };
    const queue = this.queues.get(owner);
    if (queue) queue.push(waiting);
    else {
      this.queues.set(owner, [waiting]);
      this.ring.push(owner);
    }
    this.queued += 1;
    return this.ticket(owner, ready, waiting);
  }

  private heldBy(owner: string): number {
    return this.activeBy.get(owner) ?? 0;
  }

  private take(owner: string): void {
    this.active += 1;
    this.activeBy.set(owner, this.heldBy(owner) + 1);
  }

  private ticket(owner: string, ready: Promise<void>, waiting: Waiting | null): RunTicket {
    let state: "waiting" | "running" | "done" = waiting ? "waiting" : "running";
    // The queue hands over by calling `start`, which is also what resolves `ready`.
    if (waiting) {
      const handOver = waiting.start;
      waiting.start = () => {
        state = "running";
        handOver();
      };
    }
    return {
      ready,
      release: () => {
        if (state === "done") return;
        const was = state;
        state = "done";
        if (was === "running") {
          this.active -= 1;
          const left = this.heldBy(owner) - 1;
          if (left > 0) this.activeBy.set(owner, left);
          else this.activeBy.delete(owner);
        } else if (waiting) {
          this.dequeue(waiting);
        }
        this.pump();
      },
    };
  }

  private dequeue(waiting: Waiting): void {
    const queue = this.queues.get(waiting.owner);
    if (!queue) return;
    const at = queue.indexOf(waiting);
    if (at === -1) return;
    queue.splice(at, 1);
    this.queued -= 1;
    if (queue.length === 0) this.forget(waiting.owner);
  }

  private forget(owner: string): void {
    this.queues.delete(owner);
    this.ring = this.ring.filter((o) => o !== owner);
  }

  /** Hands free slots to waiting runs, one owner after another, skipping owners at their limit. */
  private pump(): void {
    while (this.active < this.options.maxConcurrent) {
      const at = this.ring.findIndex((owner) => this.heldBy(owner) < this.options.maxPerOwner);
      if (at === -1) return;

      const owner = this.ring[at];
      const queue = this.queues.get(owner)!;
      const next = queue.shift()!;
      this.queued -= 1;

      // The owner just served goes to the back of the line, so the next slot is somebody else's.
      this.ring.splice(at, 1);
      if (queue.length === 0) this.queues.delete(owner);
      else this.ring.push(owner);

      this.take(owner);
      next.start();
    }
  }
}

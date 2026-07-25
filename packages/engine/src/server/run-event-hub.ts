import type { RunEvent } from "@zaa-tool/shared";

export type RunEventListener = (event: RunEvent) => void;

/**
 * Events are buffered per run so a client that subscribes slightly after the
 * run started still receives everything from the beginning. A run finishes long
 * before its subscriber disconnects, so finished channels are kept briefly and
 * then dropped.
 */
const MAX_EVENTS_PER_RUN = 500;
const FINISHED_RUN_RETENTION_MS = 60_000;
const MAX_TRACKED_RUNS = 200;

interface RunChannel {
  buffer: RunEvent[];
  listeners: Set<RunEventListener>;
  createdAt: number;
  /** Set once the run emitted a terminal event; channel is dropped after this. */
  expiresAt: number | null;
}

function isTerminal(event: RunEvent): boolean {
  return event.type === "flow:done" || event.type === "flow:error";
}

/**
 * Routes run events to the clients that subscribed to that specific run.
 *
 * Replaces the previous global broadcast: a listener only ever sees events for
 * run ids it explicitly asked for, so concurrent runs — and runs belonging to
 * other flows or other users — can no longer bleed into each other.
 */
export class RunEventHub {
  private channels = new Map<string, RunChannel>();

  publish(event: RunEvent): void {
    const channel = this.channelFor(event.runId);

    channel.buffer.push(event);
    if (channel.buffer.length > MAX_EVENTS_PER_RUN) {
      channel.buffer.shift();
    }
    if (isTerminal(event)) {
      channel.expiresAt = Date.now() + FINISHED_RUN_RETENTION_MS;
    }

    for (const listener of channel.listeners) {
      listener(event);
    }

    this.prune();
  }

  /**
   * Starts delivering `runId`'s events to `listener`, replaying whatever the run
   * already emitted. Returns the unsubscribe handle.
   */
  subscribe(runId: string, listener: RunEventListener): () => void {
    const channel = this.channelFor(runId);
    channel.listeners.add(listener);

    for (const event of [...channel.buffer]) {
      listener(event);
    }

    return () => {
      const current = this.channels.get(runId);
      if (!current) return;
      current.listeners.delete(listener);
    };
  }

  private channelFor(runId: string): RunChannel {
    let channel = this.channels.get(runId);
    if (!channel) {
      channel = { buffer: [], listeners: new Set(), createdAt: Date.now(), expiresAt: null };
      this.channels.set(runId, channel);
    }
    return channel;
  }

  /**
   * Drops finished channels past their retention window, and — as a backstop
   * against runs that never emit a terminal event — the oldest idle channels
   * once the tracked set grows too large.
   */
  private prune(): void {
    const now = Date.now();

    for (const [runId, channel] of this.channels) {
      if (channel.expiresAt !== null && channel.expiresAt <= now && channel.listeners.size === 0) {
        this.channels.delete(runId);
      }
    }

    if (this.channels.size <= MAX_TRACKED_RUNS) return;

    const idleOldestFirst = [...this.channels.entries()]
      .filter(([, channel]) => channel.listeners.size === 0)
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    for (const [runId] of idleOldestFirst) {
      if (this.channels.size <= MAX_TRACKED_RUNS) break;
      this.channels.delete(runId);
    }
  }
}

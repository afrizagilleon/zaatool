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

const TERMINAL_EVENTS = new Set<RunEvent["type"]>(["run:done", "run:error"]);

function isTerminal(event: RunEvent): boolean {
  return TERMINAL_EVENTS.has(event.type);
}

/**
 * Routes run events to the clients that subscribed to that specific run.
 *
 * Replaces the previous global broadcast: a listener only ever sees events for
 * run ids it explicitly asked for, so concurrent runs — and runs belonging to
 * other notebooks or other users — can no longer bleed into each other.
 */
export class RunEventHub {
  private channels = new Map<string, RunChannel>();
  private watchers = new Set<RunEventListener>();

  publish(event: RunEvent): void {
    for (const watcher of this.watchers) watcher(event);

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
   * Whether this hub still holds anything for `runId`. False for a run that finished long
   * enough ago to have been dropped — and for one that has not emitted anything yet, which
   * is why the caller must still look the run up before concluding it is over.
   */
  hasChannel(runId: string): boolean {
    return this.channels.has(runId);
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

  /**
   * Every event, for a listener that cannot know run ids in advance — the map, which
   * has to show a cron firing at 3am or an agent running a cell over MCP.
   *
   * No buffer and no replay: a watcher wants what is happening, not what happened, and
   * holding history for something nobody proved they started would be a leak waiting to
   * be found. Whoever consumes this is responsible for narrowing it down to lifecycle.
   */
  watch(listener: RunEventListener): () => void {
    this.watchers.add(listener);
    return () => {
      this.watchers.delete(listener);
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

import type { RunEventSink } from "../core/run-emitter.js";
import { matchCron } from "../core/cron.js";
import { cronTimezone } from "../config.js";
import { notebookTriggersService, type TriggerRecord } from "./notebook-triggers.service.js";
import { notebookExecutionService } from "./notebook-execution.service.js";
import { withContext } from "../core/request-context.js";

const MINUTE_MS = 60_000;

/**
 * The most minutes one tick will catch up on. A busy event loop delays a tick by seconds,
 * occasionally a few minutes; anything longer than this is treated as the process having
 * been down, and those minutes are not replayed.
 */
export const MAX_CATCH_UP_MINUTES = 5;

interface SchedulerDeps {
  listCron: () => Promise<TriggerRecord[]>;
  startRun: (
    notebookId: string,
    publish: RunEventSink,
    options: { triggerSource: "cron"; input: Record<string, unknown> }
  ) => Promise<{ runId: string }>;
  /** True while a cron run of this notebook is running or waiting for a slot. */
  hasRunInFlight?: (notebookId: string) => boolean;
}

const defaultDeps: SchedulerDeps = {
  listCron: () => notebookTriggersService.listEnabledCron(),
  startRun: (notebookId, publish, options) => notebookExecutionService.start(notebookId, publish, options),
  hasRunInFlight: (notebookId) => notebookExecutionService.hasCronRunInFlight(notebookId),
};

/**
 * Fires notebook cron triggers, each wall-clock minute exactly once.
 *
 * Reads the trigger index rather than the notebooks themselves. That distinction used to
 * matter a great deal: the canvas expressed a schedule as a `trigger:cron` *node*, so
 * finding out what was due meant loading every saved graph and walking its nodes — every
 * minute, forever. Triggers are notebook metadata now, and metadata can be indexed.
 *
 * The clock is a series of one-shot timers aimed at the next minute boundary, recomputed
 * after every tick, rather than an interval that inherits whatever drift the first tick had.
 * What makes a minute fire once is `lastMinute`, not the timer: a tick that arrives early,
 * twice or late is judged against it.
 */
export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private publishRunEvent: RunEventSink | null = null;
  /** The last minute (whole minutes since the epoch) that has been evaluated. */
  private lastMinute: number | null = null;

  constructor(private readonly deps: SchedulerDeps = defaultDeps) {}

  start(publishRunEvent: RunEventSink) {
    if (this.timer) return;
    this.begin(publishRunEvent, new Date());
    this.arm();
  }

  /**
   * Takes the sink and marks `now`'s minute as already passed. Minutes before the start
   * are never run: a schedule missed while the engine was down is not replayed.
   */
  begin(publishRunEvent: RunEventSink, now: Date) {
    this.publishRunEvent = publishRunEvent;
    this.lastMinute = Math.floor(now.getTime() / MINUTE_MS);
    console.log(
      `⏰ Background Scheduler Service started at ${now.toISOString()} (cron time zone ${cronTimezone()}); ` +
        "schedules missed while the engine was down are not replayed."
    );
  }

  private arm() {
    const wait = MINUTE_MS - (Date.now() % MINUTE_MS);
    this.timer = setTimeout(() => {
      void this.tick(new Date());
      this.arm();
    }, wait);
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Evaluates every minute not yet evaluated, up to the minute containing `now`. */
  async tick(now: Date) {
    const publish = this.publishRunEvent;
    if (!publish || this.lastMinute === null) return;

    const current = Math.floor(now.getTime() / MINUTE_MS);
    if (current <= this.lastMinute) return;

    let first = this.lastMinute + 1;
    if (current - this.lastMinute > MAX_CATCH_UP_MINUTES) {
      console.warn(
        `⏰ Scheduler tick is ${current - this.lastMinute} minutes after the last one; ` +
          `treating the gap as downtime and not replaying minutes ` +
          `${new Date(first * MINUTE_MS).toISOString()} to ${new Date((current - 1) * MINUTE_MS).toISOString()}.`
      );
      first = current;
    }
    // Claimed before the first await, so a slow database cannot let the next tick see
    // these minutes again.
    this.lastMinute = current;

    const zone = cronTimezone();
    try {
      const triggers = await this.deps.listCron();

      for (let minute = first; minute <= current; minute += 1) {
        const at = new Date(minute * MINUTE_MS);
        for (const trigger of triggers) {
          if (!trigger.cron || !matchCron(trigger.cron, at, zone)) continue;

          // A run that outlasts its period would otherwise add another copy of itself every
          // tick, each one waiting for a slot the slow one is holding.
          if (this.deps.hasRunInFlight?.(trigger.notebook_id)) {
            console.warn(
              `⏰ Notebook ${trigger.notebook_id} skipped the '${trigger.cron}' tick at ${at.toISOString()}: ` +
                "its previous cron run is still running or waiting for a slot."
            );
            continue;
          }

          try {
            // Each fire is its own context: nothing here is a request, and the run it starts
            // (and everything that run logs or records) is attributed to this trigger.
            const { runId } = await withContext(
              { actor: { type: "cron", triggerId: trigger.id, notebookId: trigger.notebook_id } },
              () =>
                this.deps.startRun(trigger.notebook_id, publish, {
                  triggerSource: "cron",
                  input: { trigger: { kind: "cron", cron: trigger.cron, firedAt: at.toISOString() } },
                })
            );
            console.log(`⏰ Notebook ${trigger.notebook_id} started run ${runId} ('${trigger.cron}')`);
          } catch (err: unknown) {
            // One misbehaving notebook must not stop the others from firing this minute. A full
            // gate does not land here until even the scheduled-run queue is full: until then a
            // cron run waits its turn rather than being dropped.
            console.error(
              `Failed to start notebook ${trigger.notebook_id} from cron '${trigger.cron}':`,
              (err as Error).message
            );
          }
        }
      }
    } catch (err) {
      console.error("Scheduler tick error:", err);
    }
  }
}

export const schedulerService = new SchedulerService();

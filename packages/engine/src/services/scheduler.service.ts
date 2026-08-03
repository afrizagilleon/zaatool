import type { RunEventSink } from "../core/run-emitter.js";
import { notebookTriggersService } from "./notebook-triggers.service.js";
import { notebookExecutionService } from "./notebook-execution.service.js";

function matchCronField(pattern: string, value: number): boolean {
  if (pattern === "*") return true;

  if (pattern.includes(",")) {
    return pattern.split(",").some((p) => matchCronField(p, value));
  }

  if (pattern.includes("/")) {
    const [range, stepStr] = pattern.split("/");
    const step = parseInt(stepStr, 10);
    if (range === "*") {
      return value % step === 0;
    }
    if (range.includes("-")) {
      const [start, end] = range.split("-").map(Number);
      return value >= start && value <= end && (value - start) % step === 0;
    }
  }

  if (pattern.includes("-")) {
    const [start, end] = pattern.split("-").map(Number);
    return value >= start && value <= end;
  }

  return parseInt(pattern, 10) === value;
}

export function matchCron(cronStr: string, date: Date): boolean {
  const parts = cronStr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const mon = date.getMonth() + 1; // 1-12
  const dow = date.getDay(); // 0-6 (Sunday-Saturday)

  return (
    matchCronField(parts[0], min) &&
    matchCronField(parts[1], hour) &&
    matchCronField(parts[2], dom) &&
    matchCronField(parts[3], mon) &&
    matchCronField(parts[4], dow)
  );
}

/**
 * Fires notebook cron triggers, once a minute.
 *
 * Reads the trigger index rather than the notebooks themselves. That distinction used to
 * matter a great deal: the canvas expressed a schedule as a `trigger:cron` *node*, so
 * finding out what was due meant loading every saved graph and walking its nodes — every
 * minute, forever. Triggers are notebook metadata now, and metadata can be indexed.
 */
export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private publishRunEvent: RunEventSink | null = null;

  start(publishRunEvent: RunEventSink) {
    this.publishRunEvent = publishRunEvent;
    if (this.timer) return;

    console.log("⏰ Background Scheduler Service started.");

    // Calculate ms until the start of the next minute to sync tick perfectly
    const nextTickMs = 60000 - (Date.now() % 60000);
    this.timer = setTimeout(() => {
      void this.tick();
      // Then tick every 60 seconds
      this.timer = setInterval(() => void this.tick(), 60000);
    }, nextTickMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    const publish = this.publishRunEvent;
    if (!publish) return;

    const now = new Date();

    try {
      const triggers = await notebookTriggersService.listEnabledCron();

      for (const trigger of triggers) {
        if (!trigger.cron || !matchCron(trigger.cron, now)) continue;

        try {
          const { runId } = await notebookExecutionService.start(trigger.notebook_id, publish, {
            triggerSource: "cron",
            input: { trigger: { kind: "cron", cron: trigger.cron, firedAt: now.toISOString() } },
          });
          console.log(`⏰ Notebook ${trigger.notebook_id} started run ${runId} ('${trigger.cron}')`);
        } catch (err: unknown) {
          // One misbehaving notebook must not stop the others from firing this minute.
          console.error(
            `Failed to start notebook ${trigger.notebook_id} from cron '${trigger.cron}':`,
            (err as Error).message
          );
        }
      }
    } catch (err) {
      console.error("Scheduler tick error:", err);
    }
  }
}

export const schedulerService = new SchedulerService();

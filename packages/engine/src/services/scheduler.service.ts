import { pool } from "../db/connection.js";
import { runFlow } from "../core/flow-runner.js";
import { createRunEmitter, type RunEventSink } from "../core/run-emitter.js";
import { notebookTriggersService } from "./notebook-triggers.service.js";
import { notebookExecutionService } from "./notebook-execution.service.js";
import { randomUUID } from "node:crypto";
import type { GraphJson } from "@zaa-tool/shared";

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
      this.tick();
      // Then tick every 60 seconds
      this.timer = setInterval(() => this.tick(), 60000);
    }, nextTickMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    const now = new Date();
    try {
      // 1. Legacy database triggers check
      const { rows: triggers } = await pool.query(
        "SELECT * FROM triggers WHERE type = 'cron' AND enabled = true"
      );

      for (const trigger of triggers) {
        let config: { cronExpression?: string; startNodeId?: string } = {};
        try {
          config = typeof trigger.config === "string" ? JSON.parse(trigger.config) : trigger.config;
        } catch (err) {
          console.error(`Failed to parse trigger ${trigger.id} config:`, err);
          continue;
        }

        const cronExpr = config.cronExpression;
        if (!cronExpr) continue;

        if (matchCron(cronExpr, now)) {
          console.log(`⏰ Triggering flow ${trigger.flow_id} via legacy cron schedule '${cronExpr}'`);
          this.executeScheduledFlow(trigger.flow_id, config.startNodeId);
        }
      }

      // 2. Notebook cron triggers. Read from the trigger index rather than by parsing
      // every notebook, which is the mistake the visual cron nodes below force.
      await this.tickNotebookCrons(now);

      // 3. Visual cron nodes check inside all flows
      const { rows: flows } = await pool.query("SELECT id, name, graph_json FROM flows");
      for (const flow of flows) {
        if (!flow.graph_json) continue;
        let graph: GraphJson = typeof flow.graph_json === "string" ? JSON.parse(flow.graph_json) : flow.graph_json;
        if (!graph || !graph.nodes) continue;

        const cronNodes = graph.nodes.filter(
          (n: any) => n.type === "trigger:cron" && n.data?.enabled !== false
        );
        for (const node of cronNodes) {
          const cronExpr = node.data?.cronExpression;
          if (cronExpr && matchCron(cronExpr, now)) {
            console.log(`⏰ Triggering flow ${flow.id} via visual cron node ${node.id} ('${cronExpr}')`);
            this.executeScheduledFlow(flow.id, node.id);
          }
        }
      }
    } catch (err) {
      console.error("Scheduler tick error:", err);
    }
  }

  private async tickNotebookCrons(now: Date) {
    const publish = this.publishRunEvent;
    if (!publish) return;

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
  }

  private async executeScheduledFlow(flowId: string, startNodeId?: string) {
    try {
      const { rows } = await pool.query("SELECT * FROM flows WHERE id = $1", [flowId]);
      if (rows.length === 0) {
        console.warn(`Scheduled flow ${flowId} not found`);
        return;
      }

      const flow = rows[0];
      const graph: GraphJson = typeof flow.graph_json === "string" ? JSON.parse(flow.graph_json) : flow.graph_json;

      if (!graph || !graph.nodes) {
        console.warn(`Scheduled flow ${flowId} has invalid graph`);
        return;
      }

      const publish = this.publishRunEvent;
      const runId = randomUUID();
      const ee = createRunEmitter({ runId, flowId }, (event) =>
        publish?.({ ...event, triggeredBy: "scheduler" })
      );

      // No seedOutputs: a scheduled run computes from the graph alone.
      await runFlow(graph, ee, startNodeId);
    } catch (err) {
      console.error(`Error executing scheduled flow ${flowId}:`, err);
    }
  }
}

export const schedulerService = new SchedulerService();

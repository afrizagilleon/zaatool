import { EventEmitter } from "node:events";
import type { RunEvent, RunEventType } from "@zaa-tool/shared";

/**
 * The concrete list lives here rather than in `shared`, which stays types-only
 * so it can be consumed from both a CJS and an ESM context.
 */
const RUN_EVENT_TYPES: readonly RunEventType[] = [
  "node:start",
  "node:log",
  "node:done",
  "node:error",
  "node:skip",
  "flow:done",
  "flow:error",
];

export interface RunIdentity {
  runId: string;
  flowId: string;
}

export type RunEventSink = (event: RunEvent) => void;

/**
 * Builds the EventEmitter handed to `runFlow`, stamping run identity onto every
 * event before it reaches the sink.
 *
 * Executors and the runner stay unaware of runs — they emit plain
 * `{ type, nodeId, … }` payloads as before, and identity is attached in exactly
 * one place so no emit site can forget it.
 */
export function createRunEmitter(identity: RunIdentity, sink: RunEventSink): EventEmitter {
  const emitter = new EventEmitter();

  for (const type of RUN_EVENT_TYPES) {
    emitter.on(type, (data: Record<string, unknown> = {}) => {
      sink({
        ...data,
        type: (data.type as RunEventType) ?? type,
        runId: identity.runId,
        flowId: identity.flowId,
      });
    });
  }

  return emitter;
}

import { EventEmitter } from "node:events";
import type { RunEvent, RunEventType } from "@zaa-tool/shared";
import { NO_REDACTION, type SecretRedactor } from "./secret-redactor.js";

/**
 * The concrete list lives here rather than in `shared`, which stays types-only
 * so it can be consumed from both a CJS and an ESM context.
 */
const RUN_EVENT_TYPES: readonly RunEventType[] = [
  "cell:start",
  "cell:log",
  "cell:done",
  "cell:error",
  "run:done",
  "run:error",
];

export interface RunIdentity {
  runId: string;
  notebookId: string;
}

export type RunEventSink = (event: RunEvent) => void;

/**
 * Builds the EventEmitter handed to the notebook runner, stamping run identity onto
 * every event before it reaches the sink.
 *
 * The runner stays unaware of runs — it emits plain `{ type, cellId, … }` payloads,
 * and identity is attached in exactly one place so no emit site can forget it.
 *
 * The same place is where the run's secrets are redacted. Every consumer of a run — the
 * WebSocket hub, the history row the recorder writes, the replies an agent is given — sits
 * behind `sink`, so redacting here means none of them has to remember to, and none can
 * receive the unredacted event. See `secret-redactor` for what that does and does not stop.
 */
export function createRunEmitter(
  identity: RunIdentity,
  sink: RunEventSink,
  redactor: SecretRedactor = NO_REDACTION
): EventEmitter {
  const emitter = new EventEmitter();

  for (const type of RUN_EVENT_TYPES) {
    emitter.on(type, (data: Record<string, unknown> = {}) => {
      sink(
        redactor.record({
          ...data,
          type: (data.type as RunEventType) ?? type,
          runId: identity.runId,
          notebookId: identity.notebookId,
        })
      );
    });
  }

  return emitter;
}

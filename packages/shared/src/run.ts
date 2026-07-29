/**
 * Contract for a single flow execution ("run") and the events it streams.
 *
 * A run is identified by an unguessable `runId` issued by the engine when
 * execution starts. Possession of that id is what authorizes a client to
 * receive the run's events — clients subscribe to one run at a time, they are
 * never sent events belonging to a run they did not start.
 */

export type RunEventType =
  // Graph runs (canvas)
  | "node:start"
  | "node:log"
  | "node:done"
  | "node:error"
  | "node:skip"
  | "flow:done"
  | "flow:error"
  // Notebook runs
  | "cell:start"
  | "cell:log"
  | "cell:done"
  | "cell:error"
  | "run:done"
  | "run:error";

/**
 * Every event leaving the engine carries the identity of the run that produced
 * it. Payload fields beyond these are event-specific (output, error, ms, …).
 */
export interface RunEvent {
  type: RunEventType;
  runId: string;
  /** Id of the document being executed — a flow id for graphs, a notebook id for notebooks. */
  flowId: string;
  nodeId?: string;
  cellId?: string;
  [key: string]: unknown;
}

/** Sent by the client over the WebSocket to start receiving a run's events. */
export interface RunSubscribeMessage {
  action: "subscribe";
  runId: string;
}

/** Response of every endpoint that starts a run. */
export interface RunStartedResponse {
  status: "started";
  runId: string;
}

/**
 * Outputs seeded into a run's scope before execution, keyed by node id.
 *
 * This exists only so the editor can re-run part of a graph without re-running
 * everything upstream. It is supplied explicitly per request by the client that
 * owns those values — it is never read from the persisted graph, so a published
 * dashboard can never serve outputs left over from a design-time session.
 */
export type SeedOutputs = Record<string, Record<string, unknown>>;

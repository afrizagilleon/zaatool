/**
 * Contract for a single notebook execution ("run") and the events it streams.
 *
 * A run is identified by an unguessable `runId` issued by the engine when
 * execution starts. Possession of that id is what authorizes a client to
 * receive the run's events — clients subscribe to one run at a time, they are
 * never sent events belonging to a run they did not start.
 */

export type RunEventType =
  | "cell:start"
  | "cell:log"
  | "cell:done"
  | "cell:error"
  | "run:done"
  | "run:error";

/**
 * Every event leaving the engine carries the identity of the run that produced
 * it, and of the notebook being run. Payload fields beyond these are
 * event-specific (output, written, error, ms, …).
 */
export interface RunEvent {
  type: RunEventType;
  runId: string;
  notebookId: string;
  cellId?: string;
  [key: string]: unknown;
}

/** Sent by the client over the WebSocket to start receiving a run's events. */
export interface RunSubscribeMessage {
  action: "subscribe";
  runId: string;
}

/**
 * Asks for run *activity* across the workspace rather than one run's events.
 *
 * The map needs this because it cannot know a run id in advance: a cron firing at 3am
 * and an agent running a cell over MCP both start runs the browser never asked for, and
 * both should light up on screen.
 */
export interface RunWatchMessage {
  action: "watch";
}

/**
 * The first thing a socket says.
 *
 * The stream used to accept anyone who connected. Holding a run id was the only thing
 * standing between a stranger and a run's output, and `watch` did not even need that — it
 * announced every notebook in the workspace by id to whoever asked.
 *
 * `token` is a session token for someone signed in, or a share token for a page handed to
 * someone who is not. What each may then ask for differs, and the engine decides that;
 * the message is the same either way.
 */
export interface RunAuthMessage {
  action: "auth";
  token: string;
}

export type RunClientMessage = RunAuthMessage | RunSubscribeMessage | RunWatchMessage;

/** Sent back when a socket is turned away, so the client can say why rather than hang. */
export interface RunDeniedEvent {
  type: "run:denied";
  reason: string;
}

/**
 * Lifecycle only — which notebook is busy and how it ended.
 *
 * Carries no output, no logs and no cell identity, because this channel is not scoped
 * to a run the client can prove it started. Anything a watcher should not see must not
 * be put in here.
 */
export interface RunActivityEvent {
  type: "run:activity";
  runId: string;
  notebookId: string;
  status: "running" | "success" | "failed";
}

/** Response of every endpoint that starts a run. */
export interface RunStartedResponse {
  status: "started";
  runId: string;
}

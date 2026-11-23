import { EventEmitter } from "node:events";

/**
 * Says that an account's sessions were ended. Knows nothing about who cares.
 *
 * Ending a session is a database write — `token_version` moves, and the next REST request
 * with the old token is refused. A WebSocket is not a request: it was checked once, when it
 * connected, and nothing asks again, so it kept streaming run output to a session that had
 * been revoked. The auth service announces here and the socket server, which is the one
 * thing holding sessions open, listens — neither imports the other.
 */
const ended = new EventEmitter();
// One listener per socket server, but tests start several.
ended.setMaxListeners(0);

export function notifySessionsEnded(userId: string): void {
  ended.emit("ended", userId);
}

/** Returns the unsubscribe handle. */
export function onSessionsEnded(listener: (userId: string) => void): () => void {
  ended.on("ended", listener);
  return () => ended.off("ended", listener);
}

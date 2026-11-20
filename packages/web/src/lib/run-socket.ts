import type { RunAuthMessage, RunSubscribeMessage } from "@zaa-tool/shared";
import { WS_BASE_URL } from "./api.js";

/**
 * Transport helpers for the run event stream, shared by page runs, notebook runs and
 * shared pages. Nothing here knows what is being executed.
 *
 * Two things now have to happen when a socket opens, in this order: say who you are, then
 * say what you want. The engine holds the second until the first has been checked, so they
 * can be sent back to back.
 */
export function connectRunSocket(
  onMessage: (event: MessageEvent) => void,
  onClose: () => void,
  onError: (err: Event) => void
): WebSocket {
  const ws = new WebSocket(WS_BASE_URL);
  ws.onmessage = onMessage;
  ws.onclose = onClose;
  ws.onerror = onError;
  return ws;
}

/**
 * Identifies the socket.
 *
 * `token` is given for a shared page, whose reader has no account and whose credential is
 * the token in the link. Left out everywhere else, where the session is the cookie the
 * browser attached to the upgrade request: there is nothing to send, and nothing this code
 * could send, because the page's script cannot read that cookie.
 */
export function authenticateSocket(ws: WebSocket, token?: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (!token) return;
  const message: RunAuthMessage = { action: "auth", token };
  ws.send(JSON.stringify(message));
}

export function subscribeToRun(ws: WebSocket, runId: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const message: RunSubscribeMessage = { action: "subscribe", runId };
  ws.send(JSON.stringify(message));
}

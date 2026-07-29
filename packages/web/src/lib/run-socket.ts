import type { RunSubscribeMessage } from "@zaa-tool/shared";
import { WS_BASE_URL } from "./api.js";

/**
 * Transport helpers for the run event stream, shared by graph runs and notebook
 * runs. Nothing here knows what is being executed — a socket receives a run's
 * events once it subscribes with the run id returned by the HTTP call.
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

export function subscribeToRun(ws: WebSocket, runId: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const message: RunSubscribeMessage = { action: "subscribe", runId };
  ws.send(JSON.stringify(message));
}

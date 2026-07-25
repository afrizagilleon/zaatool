import type { GraphJson, RunStartedResponse, RunSubscribeMessage, SeedOutputs } from "@zaa-tool/shared";
import { API_BASE_URL, WS_BASE_URL } from "./api.js";

export class EngineClient {
  /** Starts a run and returns its id — the handle used to subscribe to its events. */
  static async runFlow(
    graph: GraphJson,
    startNodeId?: string,
    seedOutputs?: SeedOutputs
  ): Promise<RunStartedResponse> {
    const res = await fetch(`${API_BASE_URL}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph, startNodeId, seedOutputs }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  static connectWebSocket(
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
   * Asks the engine to stream one run's events over this socket. Nothing is
   * delivered until this is sent; events already emitted are replayed.
   */
  static subscribeToRun(ws: WebSocket, runId: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const message: RunSubscribeMessage = { action: "subscribe", runId };
    ws.send(JSON.stringify(message));
  }
}

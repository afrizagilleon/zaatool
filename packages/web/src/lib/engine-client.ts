import type { GraphJson } from "@zaa-tool/shared";
import { API_BASE_URL, WS_BASE_URL } from "./api.js";

export class EngineClient {
  static async runFlow(graph: GraphJson, startNodeId?: string): Promise<Response> {
    return fetch(`${API_BASE_URL}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph, startNodeId }),
    });
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
}

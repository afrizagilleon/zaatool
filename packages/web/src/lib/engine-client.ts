import type { GraphJson, RunStartedResponse, SeedOutputs } from "@zaa-tool/shared";
import { API_BASE_URL } from "./api.js";
import { connectRunSocket, subscribeToRun } from "./run-socket.js";

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

  static connectWebSocket = connectRunSocket;

  /**
   * Asks the engine to stream one run's events over this socket. Nothing is
   * delivered until this is sent; events already emitted are replayed.
   */
  static subscribeToRun = subscribeToRun;
}

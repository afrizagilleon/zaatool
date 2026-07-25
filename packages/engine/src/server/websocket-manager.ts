import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import type { RunSubscribeMessage } from "@zaa-tool/shared";
import type { RunEventHub } from "./run-event-hub.js";

/** Guards against a single socket holding open an unbounded number of channels. */
const MAX_SUBSCRIPTIONS_PER_SOCKET = 20;

function parseSubscribe(raw: unknown): RunSubscribeMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const message: unknown = JSON.parse(raw);
    if (typeof message !== "object" || message === null) return null;
    const { action, runId } = message as Partial<RunSubscribeMessage>;
    if (action !== "subscribe" || typeof runId !== "string" || runId.length === 0) return null;
    return { action, runId };
  } catch {
    return null;
  }
}

/**
 * Owns the WebSocket lifecycle only. It does not decide who sees what — a
 * socket receives a run's events after it subscribes with that run's id, which
 * the client obtains from the HTTP response that started the run. Routing and
 * buffering belong to {@link RunEventHub}.
 */
export class WebSocketManager {
  private wss: WebSocketServer;

  constructor(server: Server, private hub: RunEventHub) {
    this.wss = new WebSocketServer({ server });

    this.wss.on("error", (err) => {
      console.error("❌ WebSocket server error:", err.message);
    });

    this.wss.on("connection", (ws) => {
      const unsubscribes = new Map<string, () => void>();

      ws.on("message", (raw) => {
        const message = parseSubscribe(raw.toString());
        if (!message) return;
        if (unsubscribes.has(message.runId)) return;
        if (unsubscribes.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) return;

        unsubscribes.set(
          message.runId,
          this.hub.subscribe(message.runId, (event) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(event));
            }
          })
        );
      });

      const release = () => {
        for (const unsubscribe of unsubscribes.values()) unsubscribe();
        unsubscribes.clear();
      };

      ws.on("close", release);
      ws.on("error", (err) => {
        console.error("WebSocket client error:", err.message);
        release();
      });
    });
  }

  close() {
    this.wss.close();
  }
}

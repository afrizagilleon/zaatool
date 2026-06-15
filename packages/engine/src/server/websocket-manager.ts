import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";

export class WebSocketManager {
  private wss: WebSocketServer;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on("error", (err) => {
      console.error("❌ WebSocket server error:", err.message);
    });

    this.wss.on("connection", (ws) => {
      console.log("🔌 WebSocket client connected");
      ws.on("close", () => console.log("🔌 WebSocket client disconnected"));
      ws.on("error", (err) => console.error("WebSocket client error:", err.message));
    });
  }

  broadcast(data: Record<string, unknown>) {
    const msg = JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  close() {
    this.wss.close();
  }
}

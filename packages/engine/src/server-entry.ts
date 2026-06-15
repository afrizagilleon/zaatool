import http from "http";
import { initDb } from "./db/initializer.js";
import { createApp } from "./server/app.js";
import { WebSocketManager } from "./server/websocket-manager.js";
import { schedulerService } from "./services/scheduler.service.js";

export async function startServer(port = 4000) {
  // Initialize Database
  try {
    await initDb();
  } catch (err: any) {
    console.error("❌ Failed to initialize database:", err.message);
    process.exit(1);
  }

  // Create HTTP Server
  const server = http.createServer();

  // Create WebSocket Manager
  const wssManager = new WebSocketManager(server);

  // Start the background cron scheduler
  schedulerService.start((data) => wssManager.broadcast(data));

  // Create Express App, passing WebSocket broadcast callback
  const app = createApp((data) => wssManager.broadcast(data));

  // Attach Express app to HTTP server requests
  server.on("request", app);

  // Start listening
  server.listen(port, () => {
    console.log(`✅ Server listening on http://localhost:${port}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ Port ${port} is already in use. Please choose a different port.`);
    } else {
      console.error(`❌ HTTP server error:`, err.message);
    }
    process.exit(1);
  });

  return { app, server, wssManager };
}

// Auto-run if executed directly
startServer().catch(console.error);

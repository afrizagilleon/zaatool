import http from "http";
import { initDb } from "./db/initializer.js";
import { createApp } from "./server/app.js";
import { WebSocketManager } from "./server/websocket-manager.js";
import { schedulerService } from "./services/scheduler.service.js";
import { registerDefaultExecutors } from "./core/executor-bootstrap.js";

export async function startServer(port = 4000) {
  // Register all node executors (composition root — only place wiring happens)
  registerDefaultExecutors();

  // Initialize Database
  try {
    await initDb();
  } catch (err: unknown) {
    console.error("❌ Failed to initialize database:", (err as Error).message);
    process.exit(1);
  }

  const server = http.createServer();
  const wssManager = new WebSocketManager(server);

  schedulerService.start((data) => wssManager.broadcast(data));

  const app = createApp((data) => wssManager.broadcast(data));
  server.on("request", app);

  server.listen(port, () => {
    console.log(`✅ Server listening on http://localhost:${port}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ Port ${port} is already in use.`);
    } else {
      console.error(`❌ HTTP server error:`, err.message);
    }
    process.exit(1);
  });

  return { app, server, wssManager };
}

startServer().catch(console.error);

import http from "http";
import { initDb } from "./db/initializer.js";
import { createApp } from "./server/app.js";
import { WebSocketManager } from "./server/websocket-manager.js";
import { RunEventHub } from "./server/run-event-hub.js";
import { schedulerService } from "./services/scheduler.service.js";
import { configProblems, isProduction, registrationOpen, usingDevSecret } from "./config.js";

export async function startServer(port = 4000) {
  // Before anything is opened. A misconfigured deployment that starts is worse than one
  // that does not: it looks like it works, and the thing it got wrong is the lock.
  const problems = configProblems();
  if (problems.length > 0) {
    console.error("\n❌ Refusing to start:\n");
    for (const problem of problems) console.error(`   • ${problem}\n`);
    process.exit(1);
  }

  if (!isProduction() && usingDevSecret()) {
    console.warn("⚠️  JWT_SECRET is not set; using the development secret.");
  }
  if (registrationOpen()) {
    console.warn("⚠️  ALLOW_REGISTRATION is on: anyone who can reach this port can make an account.");
  }

  // Initialize Database
  try {
    await initDb();
  } catch (err: unknown) {
    console.error("❌ Failed to initialize database:", (err as Error).message);
    process.exit(1);
  }

  const server = http.createServer();
  const runEventHub = new RunEventHub();
  const wssManager = new WebSocketManager(server, runEventHub);
  const publishRunEvent = (event: Parameters<RunEventHub["publish"]>[0]) =>
    runEventHub.publish(event);

  schedulerService.start(publishRunEvent);

  const app = createApp(publishRunEvent);
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

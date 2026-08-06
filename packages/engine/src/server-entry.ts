import http from "http";
import { networkInterfaces } from "node:os";
import { initDb } from "./db/initializer.js";
import { createApp } from "./server/app.js";
import { WebSocketManager } from "./server/websocket-manager.js";
import { RunEventHub } from "./server/run-event-hub.js";
import { schedulerService } from "./services/scheduler.service.js";
import { configProblems, isProduction, registrationOpen, usingDevSecret } from "./config.js";

/**
 * Addresses on this machine another device could actually dial.
 *
 * Printed at startup because the alternative is what happened: you were told the server
 * was on `localhost`, typed a LAN address you found yourself, and got `failed to fetch`
 * with nothing anywhere naming the address the app was really using.
 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

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

  // `0.0.0.0` rather than the default, which is the same thing today and is a default —
  // and a default is a thing that changes. Binding to every interface is the difference
  // between the app being reachable from your phone and not, so it is stated.
  const host = process.env.HOST?.trim() || "0.0.0.0";

  server.listen(port, host, () => {
    console.log(`✅ Server listening on http://localhost:${port}`);
    for (const address of lanAddresses()) {
      console.log(`   also on http://${address}:${port}`);
    }
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

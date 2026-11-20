import http from "http";
import { networkInterfaces } from "node:os";
import { initDb } from "./db/initializer.js";
import { createApp } from "./server/app.js";
import { WebSocketManager } from "./server/websocket-manager.js";
import { RunEventHub } from "./server/run-event-hub.js";
import { schedulerService } from "./services/scheduler.service.js";
import { notebookTriggersService } from "./services/notebook-triggers.service.js";
import { configProblems, isProduction, registrationOpen, secretsKey, usingDevSecret } from "./config.js";
import { secretsService, SecretsKeyMismatchError } from "./services/secrets.service.js";
import { authService } from "./services/auth.service.js";
import { sandboxWarnings } from "./core/sandbox-identity.js";

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
  if (secretsKey() === null) {
    console.warn("⚠️  SECRETS_KEY is not set; secrets are stored in plaintext in the database.");
  }
  for (const warning of sandboxWarnings(process.platform, process.env)) console.warn(`⚠️  ${warning}`);
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

  // After the tables exist and before anything is served: secrets written before encryption
  // existed are encrypted, and a key that does not open what is already encrypted stops the
  // engine rather than letting it write new secrets nobody could read back. Not in
  // `initDb()`, which creates tables and never touches rows.
  try {
    const encrypted = await secretsService.protectAtStart();
    if (encrypted > 0) console.log(`🔐 Encrypted ${encrypted} secret(s) that were stored in plaintext.`);
  } catch (err: unknown) {
    if (err instanceof SecretsKeyMismatchError) {
      console.error(`
❌ Refusing to start: ${err.message}. Restore the SECRETS_KEY these secrets were written with, or run rotate-secrets-key. See DEPLOY.md.
`);
    } else {
      console.error("❌ Failed to protect secrets:", (err as Error).message);
    }
    process.exit(1);
  }

  // After the tables exist and before anything can fire: the trigger index is brought in
  // line with what is deployed, so a table written from drafts by an older version never
  // gets to run a cron or answer a webhook. Not in `initDb()`, which creates tables and
  // never rows. Each change is logged because it is a visible change of behaviour — a
  // trigger that was only ever saved stops firing until its notebook is deployed again.
  try {
    for (const change of await notebookTriggersService.rebuildTriggerIndex()) {
      console.warn(
        `⚠️  Trigger index: ${change.change} ${change.triggerId} (notebook ${change.notebookId}) — ${change.detail}`
      );
    }
  } catch (err: unknown) {
    console.error("❌ Failed to rebuild the trigger index:", (err as Error).message);
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

  // After the tables exist, so the question "are there any accounts" has an answer.
  try {
    await authService.announceSetupCode();
  } catch (err: unknown) {
    console.error("❌ Could not work out whether a setup code is needed:", (err as Error).message);
  }

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

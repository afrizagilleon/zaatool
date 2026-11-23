import http from "http";
import { networkInterfaces } from "node:os";
import { initDb } from "./db/initializer.js";
import { createApp } from "./server/app.js";
import { WebSocketManager } from "./server/websocket-manager.js";
import { RunEventHub } from "./server/run-event-hub.js";
import { schedulerService } from "./services/scheduler.service.js";
import { notebookTriggersService } from "./services/notebook-triggers.service.js";
import { activeSandboxConfig, configProblems, isProduction, registrationOpen, secretsKey, usingDevSecret } from "./config.js";
import { secureStorageRoot } from "./core/cell-workspace.js";
import { migrateOwnerHomes } from "./core/owner-home-migration.js";
import { oomGuardWarning } from "./core/oom-guard.js";
import { STORAGE_DIR } from "./core/storage-root.js";
import { secretsService, SecretsKeyMismatchError } from "./services/secrets.service.js";
import { holdEngineLock } from "./services/engine-lock.service.js";
import { authService } from "./services/auth.service.js";
import { notebookRunsService } from "./services/notebook-runs.service.js";
import { sandboxWarnings } from "./core/sandbox-identity.js";
import { egressFirewallProblems, egressFirewallWarnings } from "./core/egress-firewall.js";
import { windowsProductionWarnings } from "./core/windows-production.js";
import { logger } from "./core/logger.js";
import { withContext } from "./core/request-context.js";

/**
 * Addresses on this machine another device could actually dial.
 *
 * Logged at startup because the alternative is what happened: you were told the server
 * was on `localhost`, typed a LAN address you found yourself, and got `failed to fetch`
 * with nothing anywhere naming the address the app was really using.
 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

/**
 * Stops the process for a reason the operator has to act on. The line is written first; the
 * logger writes synchronously to files and TTYs, which is what `docker logs` reads.
 */
function refuseToStart(event: string, msg: string, fields: Record<string, unknown> = {}): never {
  logger.fatal(msg, { event, ...fields });
  process.exit(1);
}

export async function startServer(port = 4000) {
  // Boot work is not a request: it runs as the system so its lines say so.
  return withContext({ actor: { type: "system", component: "boot" } }, () => boot(port));
}

async function boot(port: number) {
  // Before anything is opened. A misconfigured deployment that starts is worse than one
  // that does not: it looks like it works, and the thing it got wrong is the lock.
  const problems = configProblems();
  if (problems.length > 0) {
    refuseToStart("config.invalid", "Refusing to start: the configuration has problems.", { problems });
  }

  // Cells must not reach the engine's own port, the database or the rest of the network. The
  // entrypoint installs the firewall; this proves it by trying to get through as a cell uid.
  const getuid = process.getuid?.bind(process);
  const egress = await egressFirewallProblems(process.platform, process.env, getuid);
  if (egress.length > 0) {
    refuseToStart("sandbox.egress_unsafe", "Refusing to start: a cell could reach the network.", { problems: egress });
  }
  for (const warning of egressFirewallWarnings(process.platform, process.env, getuid)) {
    logger.warn(warning, { event: "sandbox.egress_warning" });
  }

  if (!isProduction() && usingDevSecret()) {
    logger.warn("JWT_SECRET is not set; using the development secret.", { event: "auth.dev_secret" });
  }
  if (secretsKey() === null) {
    logger.warn("SECRETS_KEY is not set; secrets are stored in plaintext in the database.", {
      event: "secrets.plaintext_storage",
    });
  }
  for (const warning of [...sandboxWarnings(process.platform, process.env), ...windowsProductionWarnings(process.platform, process.env)]) {
    logger.warn(warning, { event: "sandbox.warning" });
  }
  // Cells change uid: the storage folder becomes root's and closed, so what a cell can read is
  // only what the engine copies into its own folder. Before anything is served.
  try {
    if (secureStorageRoot(activeSandboxConfig(), STORAGE_DIR)) {
      logger.info("Storage folder is root-only; cells run as one user per process.", { event: "sandbox.storage_closed" });
    }
  } catch (err: unknown) {
    refuseToStart("sandbox.storage_close_failed", "Could not close the storage folder to cells.", { err });
  }
  // Homes made when every owner had a uid of its own become root's with the owner's group, and
  // the folders of processes the last engine did not get to remove are cleared. Before anything
  // is served, so no cell is running while it changes owners by path.
  try {
    const sandbox = activeSandboxConfig();
    if (sandbox) {
      const oomWarning = oomGuardWarning();
      if (oomWarning) logger.warn(oomWarning, { event: "sandbox.oom_guard_unavailable" });
      const report = migrateOwnerHomes(sandbox);
      if (report.converted.length > 0) {
        logger.info("Converted owner folders to one group per owner.", {
          event: "sandbox.owner_homes_converted",
          count: report.converted.length,
        });
      }
      if (report.clearedProcessFolders > 0) {
        logger.info("Removed cell folders left by the last run.", {
          event: "sandbox.process_folders_cleared",
          count: report.clearedProcessFolders,
        });
      }
      // Not fatal: that owner's runs refuse to start, by name, and nobody else is affected.
      for (const problem of report.problems) {
        logger.warn(problem, { event: "sandbox.owner_home_problem" });
      }
    }
  } catch (err: unknown) {
    refuseToStart("sandbox.owner_folders_failed", "Could not prepare the owner folders.", { err });
  }
  if (registrationOpen()) {
    logger.warn("ALLOW_REGISTRATION is on: anyone who can reach this port can make an account.", {
      event: "auth.registration_open",
    });
  }

  // Initialize Database
  try {
    await initDb();
  } catch (err: unknown) {
    refuseToStart("db.init_failed", "Failed to initialize the database.", { err });
  }

  // Says to the database that an engine is alive, so a key rotation refuses to run under it
  // (and an engine refuses to start while one is running). Before the secrets are touched.
  try {
    await holdEngineLock();
  } catch (err: unknown) {
    refuseToStart("engine.lock_refused", `Refusing to start: ${(err as Error).message}`);
  }

  // After the tables exist and before anything is served: secrets written before encryption
  // existed are encrypted, and a key that does not open what is already encrypted stops the
  // engine rather than letting it write new secrets nobody could read back. Not in
  // `initDb()`, which creates tables and never touches rows.
  try {
    const encrypted = await secretsService.protectAtStart();
    if (encrypted > 0) {
      logger.info("Encrypted secrets that were stored in plaintext.", {
        event: "secrets.encrypted_plaintext",
        count: encrypted,
      });
    }
  } catch (err: unknown) {
    if (err instanceof SecretsKeyMismatchError) {
      refuseToStart(
        "secrets.key_mismatch",
        `Refusing to start: ${err.message}. Restore the SECRETS_KEY these secrets were written with, or run rotate-secrets-key. See DEPLOY.md.`
      );
    }
    refuseToStart("secrets.protect_failed", "Failed to protect secrets.", { err });
  }

  // Before anything is served or can fire: a run that was in progress when the previous
  // process stopped will never be finished by anyone, so its row is closed rather than left
  // saying `running`. Not in `initDb()`, which creates tables and never touches rows.
  try {
    const interrupted = await notebookRunsService.failInterrupted();
    if (interrupted > 0) {
      logger.warn("Marked runs that were in progress at shutdown as failed.", {
        event: "runs.reconciled",
        count: interrupted,
      });
    }
  } catch (err: unknown) {
    refuseToStart("runs.reconcile_failed", "Failed to close interrupted runs.", { err });
  }

  // After the tables exist and before anything can fire: the trigger index is brought in
  // line with what is deployed, so a table written from drafts by an older version never
  // gets to run a cron or answer a webhook. Each change is logged because it is a visible
  // change of behaviour — a trigger that was only ever saved stops firing until its notebook
  // is deployed again. The trigger and notebook ids identify it; a webhook slug is a
  // credential and is never logged. Not in `initDb()`, which creates tables and never rows.
  try {
    for (const change of await notebookTriggersService.rebuildTriggerIndex()) {
      logger.warn(`Trigger index: ${change.change}.`, {
        event: "triggers.rebuilt",
        change: change.change,
        trigger_id: change.triggerId,
        notebook_id: change.notebookId,
        change_detail: change.detail,
      });
    }
  } catch (err: unknown) {
    refuseToStart("triggers.rebuild_failed", "Failed to rebuild the trigger index.", { err });
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
    logger.info(`Server listening on port ${port}.`, {
      event: "server.listening",
      port,
      host,
      addresses: lanAddresses(),
    });
  });

  // After the tables exist, so the question "are there any accounts" has an answer.
  try {
    await authService.announceSetupCode();
  } catch (err: unknown) {
    logger.error("Could not work out whether a setup code is needed.", { event: "auth.setup_code_check_failed", err });
  }

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      refuseToStart("server.port_in_use", `Port ${port} is already in use.`, { port });
    }
    refuseToStart("server.error", "The HTTP server failed.", { err });
  });

  return { app, server, wssManager };
}

// A promise nobody awaited that rejects is a bug somewhere we did not look; the process
// keeps serving, but the line says where to look. An exception nobody caught leaves the
// process in a state nobody can reason about, so it is logged and the process ends — the
// container runtime restarts it.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection.", { event: "process.unhandled_rejection", err: reason });
});
process.on("uncaughtException", (err) => {
  logger.fatal("Uncaught exception; exiting.", { event: "process.uncaught_exception", err });
  process.exit(1);
});

startServer().catch((err: unknown) => {
  refuseToStart("server.start_failed", "The server failed to start.", { err });
});

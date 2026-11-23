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
import { withContext } from "./core/request-context.js";
import { audit } from "./services/audit.service.js";

/** Boot steps that change data run as the engine itself, so what they log and record is not anonymous. */
const asSystem = <T>(component: string, run: () => Promise<T>): Promise<T> =>
  withContext({ actor: { type: "system", component } }, run);

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

  // Cells must not reach the engine's own port, the database or the rest of the network. The
  // entrypoint installs the firewall; this proves it by trying to get through as a cell uid.
  const getuid = process.getuid?.bind(process);
  const egress = await egressFirewallProblems(process.platform, process.env, getuid);
  if (egress.length > 0) {
    console.error("\n❌ Refusing to start:\n");
    for (const problem of egress) console.error(`   • ${problem}\n`);
    process.exit(1);
  }
  for (const warning of egressFirewallWarnings(process.platform, process.env, getuid)) {
    console.warn(`⚠️  ${warning}`);
  }

  if (!isProduction() && usingDevSecret()) {
    console.warn("⚠️  JWT_SECRET is not set; using the development secret.");
  }
  if (secretsKey() === null) {
    console.warn("⚠️  SECRETS_KEY is not set; secrets are stored in plaintext in the database.");
  }
  for (const warning of [...sandboxWarnings(process.platform, process.env), ...windowsProductionWarnings(process.platform, process.env)]) {
    console.warn(`⚠️  ${warning}`);
  }
  // Cells change uid: the storage folder becomes root's and closed, so what a cell can read is
  // only what the engine copies into its own folder. Before anything is served.
  try {
    if (secureStorageRoot(activeSandboxConfig(), STORAGE_DIR)) {
      console.log("🔒 Storage folder is root-only; cells run as one user per process.");
    }
  } catch (err: unknown) {
    console.error("❌ Could not close the storage folder to cells:", (err as Error).message);
    process.exit(1);
  }
  // Homes made when every owner had a uid of its own become root's with the owner's group, and
  // the folders of processes the last engine did not get to remove are cleared. Before anything
  // is served, so no cell is running while it changes owners by path.
  try {
    const sandbox = activeSandboxConfig();
    if (sandbox) {
      const oomWarning = oomGuardWarning();
      if (oomWarning) console.warn(`⚠️  ${oomWarning}`);
      const report = migrateOwnerHomes(sandbox);
      if (report.converted.length > 0) {
        console.log(`🔒 Converted ${report.converted.length} owner folder(s) to one group per owner.`);
      }
      if (report.clearedProcessFolders > 0) {
        console.log(`🧹 Removed ${report.clearedProcessFolders} cell folder(s) left by the last run.`);
      }
      if (report.problems.length > 0) {
        // Not fatal: that owner's runs refuse to start, by name, and nobody else is affected.
        for (const problem of report.problems) console.warn(`⚠️  ${problem}`);
      }
    }
  } catch (err: unknown) {
    console.error("❌ Could not prepare the owners' folders:", (err as Error).message);
    process.exit(1);
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

  // Says to the database that an engine is alive, so a key rotation refuses to run under it
  // (and an engine refuses to start while one is running). Before the secrets are touched.
  try {
    await holdEngineLock();
  } catch (err: unknown) {
    console.error(`❌ Refusing to start: ${(err as Error).message}`);
    process.exit(1);
  }

  // After the tables exist and before anything is served: secrets written before encryption
  // existed are encrypted, and a key that does not open what is already encrypted stops the
  // engine rather than letting it write new secrets nobody could read back. Not in
  // `initDb()`, which creates tables and never touches rows.
  try {
    const encrypted = await asSystem("secrets-protect", () => secretsService.protectAtStart());
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

  // Before anything is served or can fire: a run that was in progress when the previous
  // process stopped will never be finished by anyone, so its row is closed rather than left
  // saying `running`. Not in `initDb()`, which creates tables and never touches rows.
  try {
    const interrupted = await asSystem("run-reconcile", () => notebookRunsService.failInterrupted());
    if (interrupted > 0) console.warn(`⚠️  Marked ${interrupted} run(s) that were in progress at shutdown as failed.`);
  } catch (err: unknown) {
    console.error("❌ Failed to close interrupted runs:", (err as Error).message);
    process.exit(1);
  }

  // After the tables exist and before anything can fire: the trigger index is brought in
  // line with what is deployed, so a table written from drafts by an older version never
  // gets to run a cron or answer a webhook. Not in `initDb()`, which creates tables and
  // never rows. Each change is logged because it is a visible change of behaviour — a
  // trigger that was only ever saved stops firing until its notebook is deployed again.
  try {
    for (const change of await asSystem("trigger-index", () => notebookTriggersService.rebuildTriggerIndex())) {
      console.warn(
        `⚠️  Trigger index: ${change.change} ${change.triggerId} (notebook ${change.notebookId}) — ${change.detail}`
      );
    }
  } catch (err: unknown) {
    console.error("❌ Failed to rebuild the trigger index:", (err as Error).message);
    process.exit(1);
  }

  // The reconciliation above is done: this is the moment the engine is, for the trail, started.
  await asSystem("boot", () =>
    audit.record({
      action: "engine.start",
      target: { type: "engine" },
      meta: {
        version: process.env.BUILD_VERSION || "dev",
        commit: process.env.BUILD_COMMIT || "unknown",
        port,
        registrationOpen: registrationOpen(),
        encryptionAtRest: secretsKey() !== null,
      },
    })
  );
  // Old audit rows are removed daily, as the retention setting says.
  audit.startRetention();

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

/**
 * The way back in when a password is gone.
 *
 *   pnpm --filter @zaa-tool/engine reset-password <username>
 *   pnpm --filter @zaa-tool/engine reset-password <username> --password foobar123
 *   pnpm --filter @zaa-tool/engine reset-password <username> --role creator
 *   pnpm --filter @zaa-tool/engine reset-password --list
 */
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService, isRole } from "../src/services/auth.service.js";
import { promptPassword } from "./prompt-password.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  await initDb();

  if (args.length === 0 || args[0] === "--list") {
    const users = await authService.listUsers();
    if (users.length === 0) {
      console.log("\n  No accounts yet. The first person to register becomes the creator.\n");
      return;
    }
    console.log("");
    for (const user of users) {
      console.log(`  ${user.username.padEnd(24)} ${user.role}`);
    }
    console.log("\n  Usage: reset-password <username> [--password <value>] [--role creator|viewer]\n");
    return;
  }

  const username = args[0];

  const roleIndex = args.indexOf("--role");
  const role = roleIndex === -1 ? undefined : args[roleIndex + 1];

  if (role !== undefined && !isRole(role)) {
    throw new Error("--role must be creator or viewer");
  }

  const passwordIndex = args.indexOf("--password");
  let password = passwordIndex === -1 ? undefined : args[passwordIndex + 1];

  if (!password) {
    password = await promptPassword("New password: ");
  }

  const changed = await authService.setPassword(username, password);
  if (!changed) {
    throw new Error(`No account named "${username}". Run with --list to see them.`);
  }

  if (role) await authService.setRole(username, role);

  console.log(`\n  Password updated for ${username}${role ? ` (role: ${role})` : ""}.\n`);
}

main()
  .catch((err: unknown) => {
    console.error(`\n  ${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

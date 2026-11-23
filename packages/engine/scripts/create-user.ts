/**
 * CLI command to create a new user account.
 *
 *   pnpm --filter @zaa-tool/engine create-user <username> --role creator|viewer [--password <value>] [--email <value>]
 */
import { asOperator } from "./operator-context.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService, isRole } from "../src/services/auth.service.js";
import { promptPassword } from "./prompt-password.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  await initDb();

  if (args.length === 0 || args[0] === "--help") {
    console.log("\n  Usage: create-user <username> --role creator|viewer [--password <value>] [--email <value>]\n");
    process.exitCode = 1;
    return;
  }

  const username = args[0];
  if (username.startsWith("--")) {
    throw new Error("Username is required as the first argument.");
  }

  const roleIndex = args.indexOf("--role");
  const role = roleIndex === -1 ? undefined : args[roleIndex + 1];

  if (!role || !isRole(role)) {
    throw new Error("--role is required and must be 'creator' or 'viewer'");
  }

  const emailIndex = args.indexOf("--email");
  const email = emailIndex === -1 ? undefined : args[emailIndex + 1];

  const passwordIndex = args.indexOf("--password");
  let password = passwordIndex === -1 ? undefined : args[passwordIndex + 1];

  if (!password) {
    password = await promptPassword("Password: ");
  }

  const user = await authService.createUser(username, password, role, email);
  console.log(`\n  User ${user.username} created successfully with role ${user.role}.\n`);
}

asOperator("create-user", main)
  .catch((err: unknown) => {
    console.error(`\n  ${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

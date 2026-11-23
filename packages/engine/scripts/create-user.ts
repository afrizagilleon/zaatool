/**
 * CLI command to create a new user account.
 *
 *   pnpm --filter @zaa-tool/engine create-user <username> --role creator|viewer [--password-stdin] [--email <value>]
 */
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService, isRole } from "../src/services/auth.service.js";
import { humanMessage } from "./cli-error.js";
import { promptPassword, readPasswordFromStdin, refusePasswordFlag } from "./prompt-password.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  refusePasswordFlag(args);
  await initDb();

  if (args.length === 0 || args[0] === "--help") {
    console.log("\n  Usage: create-user <username> --role creator|viewer [--password-stdin] [--email <value>]\n");
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

  // Never in argv; see refusePasswordFlag. Checked before the database is touched.
  const password = args.includes("--password-stdin")
    ? await readPasswordFromStdin()
    : await promptPassword("Password: ");

  const user = await authService.createUser(username, password, role, email);
  console.log(`\n  User ${user.username} created successfully with role ${user.role}.\n`);
}

main()
  .catch((err: unknown) => {
    console.error(`\n  ${humanMessage(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

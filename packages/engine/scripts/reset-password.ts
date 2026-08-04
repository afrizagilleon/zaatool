/**
 * The way back in when a password is gone.
 *
 *   pnpm --filter @zaa-tool/engine reset-password <username>
 *   pnpm --filter @zaa-tool/engine reset-password <username> --role creator
 *   pnpm --filter @zaa-tool/engine reset-password --list
 *
 * There is no email path and there will not be one: this project has no mail server, and
 * a reset link is only as trustworthy as the mailbox it lands in. The person who can reach
 * this terminal is the person who owns the machine — which is the same authority a reset
 * email is trying, badly, to stand in for.
 *
 * The new password is generated here rather than typed, because a password typed at a
 * prompt in a hurry is the one that ends up shared. It is printed once. Change it after
 * signing in if you want one you can remember.
 */
import crypto from "crypto";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService, isRole } from "../src/services/auth.service.js";

/** Unambiguous when read aloud or copied by hand: no O/0, no l/1. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newPassword(length = 20): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

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
    console.log("\n  Usage: reset-password <username> [--role creator|viewer]\n");
    return;
  }

  const username = args[0];
  const roleIndex = args.indexOf("--role");
  const role = roleIndex === -1 ? undefined : args[roleIndex + 1];

  if (role !== undefined && !isRole(role)) {
    throw new Error("--role must be creator or viewer");
  }

  const password = newPassword();
  const changed = await authService.setPassword(username, password);
  if (!changed) {
    throw new Error(`No account named "${username}". Run with --list to see them.`);
  }

  if (role) await authService.setRole(username, role);

  console.log(`\n  ${username}${role ? ` · now a ${role}` : ""}\n`);
  console.log(`  ${password}\n`);
  console.log("  Shown once. Sign in with it now.\n");
}

main()
  .catch((err: unknown) => {
    console.error(`\n  ${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

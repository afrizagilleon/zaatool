/**
 * The way back in when a password is gone.
 *
 *   pnpm --filter @zaa-tool/engine reset-password <username>
 *   pnpm --filter @zaa-tool/engine reset-password <username> --password-stdin
 *   pnpm --filter @zaa-tool/engine reset-password <username> --prompt
 *   pnpm --filter @zaa-tool/engine reset-password <username> --role creator
 *   pnpm --filter @zaa-tool/engine reset-password --list
 *
 * There is no email path and there will not be one: this project has no mail server, and
 * a reset link is only as trustworthy as the mailbox it lands in. The person who can reach
 * this terminal is the person who owns the machine — which is the same authority a reset
 * email is trying, badly, to stand in for.
 *
 * Three ways to say what the new password is, and the default matters. With no flag one
 * is **generated** here rather than typed, because a password typed at a prompt in a hurry
 * is the one that ends up shared. It is printed once. `--password-stdin` is for when you already
 * know what you want and a script supplies it (a password in argv would sit in shell history
 * and the process list, so `--password` is refused); `--prompt` is for when you want to type it where nobody can read it
 * off your screen or your shell history.
 *
 * FX7 briefly made `--prompt` the default and deleted the generator outright. That was a
 * loss, not a simplification: it removed the only path that hands you a strong password
 * when you are locked out and in no state to invent one.
 */
import { asOperator } from "./operator-context.js";
import crypto from "crypto";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService, isRole } from "../src/services/auth.service.js";
import { humanMessage } from "./cli-error.js";
import { promptPassword, readPasswordFromStdin, refusePasswordFlag } from "./prompt-password.js";

/** Unambiguous when read aloud or copied by hand: no O/0, no l/1. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newPassword(length = 20): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  refusePasswordFlag(args);
  await initDb();

  if (args.length === 0 || args[0] === "--list") {
    const users = await authService.listUsers();
    if (users.length === 0) {
      console.log("\n  No accounts yet. The first person to register becomes the creator.\n");
      return;
    }
    console.log("");
    for (const user of users) {
      console.log(`  ${user.username.padEnd(24)} ${user.role}${user.active ? "" : "  (deactivated)"}`);
    }
    console.log(
      "\n  Usage: reset-password <username> [--password-stdin | --prompt] [--role creator|viewer]\n"
    );
    return;
  }

  const username = args[0];

  const roleIndex = args.indexOf("--role");
  const role = roleIndex === -1 ? undefined : args[roleIndex + 1];

  if (role !== undefined && !isRole(role)) {
    throw new Error("--role must be creator or viewer");
  }

  let password: string;
  let generated = false;
  if (args.includes("--password-stdin")) {
    password = await readPasswordFromStdin();
  } else if (args.includes("--prompt")) {
    password = await promptPassword("New password: ");
  } else {
    password = newPassword();
    generated = true;
  }

  const changed = await authService.setPassword(username, password);
  if (!changed) {
    throw new Error(`No account named "${username}". Run with --list to see them.`);
  }

  if (role) await authService.setRole(username, role);

  console.log(`\n  ${username}${role ? ` · now a ${role}` : ""}\n`);
  if (generated) {
    console.log(`  ${password}\n`);
    console.log("  Shown once. Sign in with it now.\n");
  } else {
    console.log("  Password updated.\n");
  }
}

asOperator("reset-password", main)
  .catch((err: unknown) => {
    console.error(`\n  ${humanMessage(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

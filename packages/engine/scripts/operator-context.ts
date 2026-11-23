import os from "node:os";
import { withContext } from "../src/core/request-context.js";

/**
 * Runs a command-line script as an identified operator.
 *
 * These scripts act with full database access and no login, so what they change would
 * otherwise reach the audit trail as nobody. The actor is the script's name and the
 * operating-system account that ran it (the person who has shell access to the server),
 * which is as much as can be known: the OS user is self-evident, not proven by the engine.
 */
export function asOperator<T>(command: string, run: () => Promise<T>): Promise<T> {
  let osUser: string | undefined;
  try {
    osUser = os.userInfo().username;
  } catch {
    // No passwd entry for this uid (some containers): the command is still worth recording.
  }
  return withContext({ actor: { type: "cli", command, osUser } }, run);
}

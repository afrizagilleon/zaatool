/**
 * A creator account for tests that make notebooks through the services.
 *
 * Since FX-17 a notebook without an owner runs with no secrets, calls nothing and is
 * reachable by nobody over REST, so a fixture that used to be "just a notebook" now needs
 * someone to belong to. Not a test itself: `run-all.ts` only picks up `*.test.ts`.
 *
 * The account is `zz-own-<label>` and is made on first use; `dropOwner` removes it.
 */
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";

const PASSWORD = "zz-owner-password-long";

export async function testOwner(label: string): Promise<{ id: string; username: string; token: string }> {
  const username = `zz-own-${label}`;
  await pool.query("DELETE FROM users WHERE username = $1", [username]);
  const user = await authService.createUser(username, PASSWORD, "creator");
  const token = (await authService.login(username, PASSWORD)).token;
  return { id: user.id, username, token };
}

export async function dropOwner(label: string): Promise<void> {
  await pool.query("DELETE FROM users WHERE username = $1", [`zz-own-${label}`]);
}

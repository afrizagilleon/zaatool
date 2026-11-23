/**
 * Mints, lists and revokes the tokens agents connect with.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx scripts/agent-token.ts issue "claude code" author --user <username>
 *   pnpm --filter @zaa-tool/engine exec tsx scripts/agent-token.ts list
 *   pnpm --filter @zaa-tool/engine exec tsx scripts/agent-token.ts revoke <id>
 *
 * A token acts as the account it was issued for, so `--user` is not optional: an agent that
 * belonged to nobody would see nothing, and one that belonged to everybody would see
 * everything. `list` here shows every token on the installation, with whose it is.
 *
 * A token is shown once, at creation. Only its hash is stored, so a lost one is
 * replaced rather than recovered.
 */
import { asOperator } from "./operator-context.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { agentTokensService, type AgentScope } from "../src/services/agent-tokens.service.js";
import { humanMessage } from "./cli-error.js";

const SCOPES: AgentScope[] = ["author", "reader"];

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  await initDb();

  if (command === "issue") {
    const userFlag = rest.indexOf("--user");
    const username = userFlag === -1 ? undefined : rest[userFlag + 1];
    const positional =
      userFlag === -1 ? rest : rest.filter((_, index) => index !== userFlag && index !== userFlag + 1);
    const label = positional[0];
    const scope = (positional[1] ?? "author") as AgentScope;

    if (!label || !username) {
      throw new Error('Usage: agent-token.ts issue "<label>" [author|reader] --user <username>');
    }
    if (!SCOPES.includes(scope)) throw new Error(`Scope must be one of: ${SCOPES.join(", ")}`);

    const { rows } = await pool.query<{ id: string }>("SELECT id FROM users WHERE username = $1", [
      username,
    ]);
    if (!rows[0]) throw new Error(`There is no account named "${username}".`);

    const { token, record } = await agentTokensService.issue(rows[0].id, label, scope);
    console.log(`\n  ${record.label} · ${record.scope} · id ${record.id}\n`);
    console.log(`  ${token}\n`);
    console.log("  Copy it now — it is not stored and cannot be shown again.\n");
    return;
  }

  if (command === "list") {
    const tokens = await agentTokensService.list();
    if (tokens.length === 0) {
      console.log("\n  No active agent tokens.\n");
      return;
    }
    const { rows: users } = await pool.query<{ id: string; username: string }>(
      "SELECT id, username FROM users"
    );
    const nameOf = new Map(users.map((user) => [user.id, user.username]));
    console.log("");
    for (const token of tokens) {
      const used = token.last_used_at ? token.last_used_at.toISOString() : "never used";
      const who = token.user_id ? (nameOf.get(token.user_id) ?? "?") : "nobody";
      console.log(
        `  ${token.id}  ${token.scope.padEnd(6)}  ${who.padEnd(12)}  ${token.label}  (${used})`
      );
    }
    console.log("");
    return;
  }

  if (command === "revoke") {
    const id = rest[0];
    if (!id) throw new Error("Usage: agent-token.ts revoke <id>");
    const { revoked } = await agentTokensService.revoke(id);
    console.log(revoked ? `\n  Revoked ${id}.\n` : `\n  No active token with id ${id}.\n`);
    return;
  }

  throw new Error("Usage: agent-token.ts <issue|list|revoke> …");
}

asOperator("agent-token", main)
  .then(() => pool.end())
  .catch(async (err: unknown) => {
    console.error(`\n  ${humanMessage(err)}\n`);
    await pool.end();
    process.exit(1);
  });

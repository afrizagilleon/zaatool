/**
 * Mints, lists and revokes the tokens agents connect with.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx scripts/agent-token.ts issue "claude code" author
 *   pnpm --filter @zaa-tool/engine exec tsx scripts/agent-token.ts list
 *   pnpm --filter @zaa-tool/engine exec tsx scripts/agent-token.ts revoke <id>
 *
 * A token is shown once, at creation. Only its hash is stored, so a lost one is
 * replaced rather than recovered.
 */
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { agentTokensService, type AgentScope } from "../src/services/agent-tokens.service.js";

const SCOPES: AgentScope[] = ["author", "reader"];

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  await initDb();

  if (command === "issue") {
    const label = rest[0];
    const scope = (rest[1] ?? "author") as AgentScope;

    if (!label) throw new Error('Usage: agent-token.ts issue "<label>" [author|reader]');
    if (!SCOPES.includes(scope)) throw new Error(`Scope must be one of: ${SCOPES.join(", ")}`);

    const { token, record } = await agentTokensService.issue(label, scope);
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
    console.log("");
    for (const token of tokens) {
      const used = token.last_used_at ? token.last_used_at.toISOString() : "never used";
      console.log(`  ${token.id}  ${token.scope.padEnd(6)}  ${token.label}  (${used})`);
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

main()
  .then(() => pool.end())
  .catch(async (err: unknown) => {
    console.error(`\n  ${(err as Error).message}\n`);
    await pool.end();
    process.exit(1);
  });

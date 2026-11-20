/**
 * Replaces the key the secrets are encrypted with.
 *
 *   SECRETS_KEY=<old> NEW_SECRETS_KEY=<new> pnpm --filter @zaa-tool/engine rotate-secrets-key
 *
 * Every row is decrypted with the old key and encrypted with the new one in a single
 * transaction: either all of them change or none do. Afterwards put the new key in `.env` as
 * `SECRETS_KEY` and restart the engine — until then it still holds the old key and will refuse
 * to start against the re-encrypted rows. Keep the new key apart from your database backups;
 * a key that is lost takes every secret with it.
 */
import { pool } from "../src/db/connection.js";
import { parseSecretsKey } from "../src/core/secrets-crypto.js";
import { secretsService } from "../src/services/secrets.service.js";

async function main(): Promise<void> {
  const oldKey = parseSecretsKey(process.env.SECRETS_KEY);
  const newKey = parseSecretsKey(process.env.NEW_SECRETS_KEY);
  if (!oldKey) throw new Error("SECRETS_KEY (the current key) must be 64 hex characters.");
  if (!newKey) {
    throw new Error("NEW_SECRETS_KEY must be 64 hex characters. Make one with: openssl rand -hex 32");
  }
  if (oldKey.equals(newKey)) throw new Error("NEW_SECRETS_KEY is the same as SECRETS_KEY.");

  const count = await secretsService.rotateKey(oldKey, newKey);
  console.log(`\n  Re-encrypted ${count} secret(s) with the new key.`);
  console.log("  Next: set SECRETS_KEY in .env to the new key, then restart the engine");
  console.log("  (docker compose up -d). Keep a copy of the key apart from your backups.\n");
}

main()
  .catch((err: unknown) => {
    console.error(`\n  ${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

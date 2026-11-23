/**
 * Checks that the audit trail has not been altered.
 *
 *   pnpm --filter @zaa-tool/engine audit-verify
 *
 * Reads every row in order and recomputes its hash from its content and the hash of the one
 * before. Exits 0 when the chain is intact and 1 when it is not (naming the first row that
 * does not fit), so it can run from cron or CI.
 *
 * If the retention job has removed old rows, the oldest row left is the anchor: its own
 * `prev_hash` is accepted as given, and printed so it can be compared with an export or with
 * the `audit.prune` event. A chain cannot show that its *newest* rows were removed; keep an
 * exported copy (`GET /api/audit/export`) for that.
 */
import { pool } from "../src/db/connection.js";
import { audit, GENESIS_HASH } from "../src/services/audit.service.js";

async function main(): Promise<number> {
  const verdict = await audit.verifyChain();
  if (verdict.checked === 0 && verdict.ok) {
    console.log("\n  The audit trail is empty.\n");
    return 0;
  }
  if (!verdict.ok) {
    console.log(
      `\n  BROKEN at row ${verdict.brokenAt?.id} (${verdict.brokenAt?.reason}) after ${verdict.checked} good row(s).\n`
    );
    return 1;
  }
  const from = verdict.anchor === GENESIS_HASH ? "the start of the chain" : `an anchor (${verdict.anchor})`;
  console.log(`\n  OK: ${verdict.checked} row(s), ids ${verdict.firstId} to ${verdict.lastId}, from ${from}.\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`\n  ${(err as Error).message}\n`);
    process.exitCode = 2;
  })
  .finally(() => pool.end());

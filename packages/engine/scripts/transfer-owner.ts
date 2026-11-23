/**
 * Hands notebooks from one account to another. There is no administrator in the app, so this
 * is how a notebook is recovered when its owner has left, and how one that has no owner at
 * all gets one. It runs on the server, as whoever runs the server.
 *
 *   pnpm --filter @zaa-tool/engine transfer-owner <from-username> <to-username> [--notebook <id>]
 *   pnpm --filter @zaa-tool/engine transfer-owner --orphaned <to-username> [--notebook <id>]
 *
 * Every notebook the first account owns moves to the second, or just the one named by
 * `--notebook`. `--orphaned` takes the ones nobody owns instead.
 *
 * A notebook runs with its owner's secrets, so the secrets the moved notebooks name (and the
 * secrets guarding their webhooks) are copied to the new owner when they do not already have
 * one by that name. Theirs wins when they do. The old owner keeps theirs.
 */
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebookAccessService } from "../src/services/notebook-access.service.js";
import { humanMessage } from "./cli-error.js";

const USAGE =
  "Usage: transfer-owner <from-username | --orphaned> <to-username> [--notebook <id>]";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help") {
    console.log(`\n  ${USAGE}\n`);
    process.exitCode = args.length === 0 ? 1 : 0;
    return;
  }

  const notebookFlag = args.indexOf("--notebook");
  const notebookId = notebookFlag === -1 ? undefined : args[notebookFlag + 1];
  if (notebookFlag !== -1 && !notebookId) throw new Error(`--notebook needs an id. ${USAGE}`);

  const positional =
    notebookFlag === -1
      ? args
      : args.filter((_, index) => index !== notebookFlag && index !== notebookFlag + 1);
  const orphaned = positional[0] === "--orphaned";
  const [from, to] = orphaned ? [undefined, positional[1]] : [positional[0], positional[1]];
  if (!to || (!orphaned && !from)) throw new Error(USAGE);

  await initDb();
  const moved = await notebookAccessService.transferOwner(to, {
    username: from,
    orphaned,
    notebookId,
  });

  if (moved.notebooks.length === 0) {
    throw new Error(
      `No notebooks moved: ${orphaned ? "none without an owner" : `"${from}" owns none`}` +
        `${notebookId ? ` matching ${notebookId}` : ""}.`
    );
  }

  console.log(`\n  ${moved.notebooks.length} notebook(s) now belong to ${to}:`);
  for (const id of moved.notebooks) console.log(`    ${id}`);
  if (moved.copiedSecrets.length > 0) {
    console.log(`  Copied to ${to}: ${moved.copiedSecrets.join(", ")}`);
  }
  console.log("");
}

main()
  .catch((err: unknown) => {
    console.error(`\n  ${humanMessage(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

/**
 * Every test file in this folder, one process each.
 *
 *   pnpm --filter @zaa-tool/engine test
 *   pnpm --filter @zaa-tool/engine test notebook-text
 *
 * Separate processes rather than one: several of these open a server, a database pool and
 * a WebSocket, and a leaked handle in one file would otherwise hang all the others. The
 * cost is a slower run; the benefit is that a failure names one file.
 *
 * An argument filters by substring, which is how you re-run the one that broke.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

const files = readdirSync(here)
  .filter((name) => name.endsWith(".test.ts"))
  .filter((name) => !filter || name.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(`\nNo test file matches "${filter}".\n`);
  process.exit(1);
}

const failed: string[] = [];

for (const file of files) {
  console.log(`\n== ${file}`);
  const code = await new Promise<number>((resolve) => {
    const child = spawn("node", ["--import", "tsx", path.join(here, file)], {
      stdio: "inherit",
      cwd: path.resolve(here, ".."),
    });
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) failed.push(file);
}

console.log("");
if (failed.length > 0) {
  console.log(`${failed.length} of ${files.length} files failed:`);
  for (const file of failed) console.log(`  ${file}`);
  console.log("");
  process.exit(1);
}

console.log(`All ${files.length} test files passed.\n`);

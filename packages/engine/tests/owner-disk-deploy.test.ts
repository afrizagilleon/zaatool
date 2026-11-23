/**
 * S-14, the install side: deploying a Python notebook that declares packages runs `uv`, which
 * fills the owner's package cache, so an owner who is over their disk quota is refused at
 * deploy with the same message a cell gets, and `uv` is never started.
 *
 * Everything it makes is prefixed `zz-owndisk-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test owner-disk-deploy
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebooksService, DeployRefusedError } from "../src/services/notebooks.service.js";
import { cellHostForOwner } from "../src/services/cell-host.service.js";
import { dropOwner, testOwner } from "./owners.js";

let passed = 0;
let failed = 0;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n").join("\n       ")}`);
  }
}

await initDb();
const owner = (await testOwner("owndisk")).id;
const previous = process.env.MAX_OWNER_DISK_MB;
process.env.MAX_OWNER_DISK_MB = "1";

async function clean(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-owndisk-%'");
  for (const row of rows) await notebooksService.delete(row.id).catch(() => undefined);
}
await clean();

console.log("\nS-14: deploy installs packages under the owner's quota");

await check("an owner over quota cannot deploy a notebook with packages, and uv does not run", async () => {
  const host = await cellHostForOwner(owner, new Set());
  const junk = path.join(host.home, "tmp", "junk.bin");
  fs.mkdirSync(path.dirname(junk), { recursive: true });
  fs.writeFileSync(junk, Buffer.alloc(3 * 1024 * 1024, 1));
  // A requirement that cannot resolve: were `uv` to run it would not produce this message.
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name: "zz-owndisk-py",
      runtime: "python",
      packages: ["zz-no-such-package-owndisk"],
      steps: [{ id: "c1", kind: "cell", code: "return {}" }],
    },
    "test",
    owner
  );
  await assert.rejects(
    () => notebooksService.deploy(saved.id, "test"),
    (err: unknown) => err instanceof DeployRefusedError && /Not enough disk space/.test(err.message)
  );
  const { rows } = await pool.query("SELECT deployed_version_id FROM notebooks WHERE id = $1", [saved.id]);
  assert.equal(rows[0].deployed_version_id, null, "nothing was deployed");
  fs.rmSync(junk, { force: true });
});

await clean();
await dropOwner("owndisk");
if (previous === undefined) delete process.env.MAX_OWNER_DISK_MB;
else process.env.MAX_OWNER_DISK_MB = previous;
await pool.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

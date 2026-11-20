/**
 * FX-17 — who owns what.
 *
 * A notebook has one owner. The owner and the editors they invite can see and change it;
 * everyone else is told it does not exist. A deployed notebook is an app, and an app is
 * used by everybody or by a chosen few, who never see its source and only see their own
 * runs. Secrets and agent tokens belong to the account that made them.
 *
 * Everything this creates is prefixed `zz-fx17-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test fx17-ownership
 */
import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => Promise<void> | void): Promise<void> {
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

const PASSWORD = "zz-fx17-password-long";

async function clean(): Promise<void> {
  await pool.query("DELETE FROM notebook_runs WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx17-%')");
  await pool.query("DELETE FROM notebook_triggers WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx17-%')");
  await pool.query("UPDATE notebooks SET deployed_version_id = NULL WHERE name LIKE 'zz-fx17-%'");
  await pool.query("DELETE FROM notebook_versions WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx17-%')");
  await pool.query("DELETE FROM notebook_shares WHERE notebook_id IN (SELECT id FROM notebooks WHERE name LIKE 'zz-fx17-%')");
  await pool.query("DELETE FROM notebooks WHERE name LIKE 'zz-fx17-%'");
  await pool.query("DELETE FROM secrets WHERE key LIKE 'zz-fx17-%'");
  await pool.query("DELETE FROM agent_tokens WHERE label LIKE 'zz-fx17-%'");
  await pool.query("DELETE FROM users WHERE username LIKE 'zz-fx17-%'");
}

await initDb();
await clean();

// ── the migration (T-01) ──────────────────────────────────────────────────────
//
// Run first, against a schema put back the way it was before this work: no owner column,
// the old UNIQUE(key) on secrets, no user on a token. `initDb()` is then the migration.

console.log("\nmigrating an installation that predates owners");

async function legacySchema(): Promise<void> {
  await pool.query("ALTER TABLE notebooks DROP COLUMN IF EXISTS owner_id CASCADE");
  await pool.query("ALTER TABLE secrets DROP COLUMN IF EXISTS owner_id CASCADE");
  await pool.query("ALTER TABLE secrets DROP CONSTRAINT IF EXISTS secrets_key_key");
  await pool.query("ALTER TABLE secrets ADD CONSTRAINT secrets_key_key UNIQUE (key)");
  await pool.query("ALTER TABLE agent_tokens DROP COLUMN IF EXISTS user_id CASCADE");
}

async function seedUser(name: string, role: "creator" | "viewer", createdAt: string): Promise<string> {
  const user = await authService.createUser(`zz-fx17-${name}`, PASSWORD, role);
  await pool.query("UPDATE users SET created_at = $1 WHERE id = $2", [createdAt, user.id]);
  return user.id;
}

async function seedNotebook(name: string, deployedBy: string | null): Promise<string> {
  const id = `zz-fx17-nb-${name}`;
  await pool.query(
    "INSERT INTO notebooks (id, name, runtime, document) VALUES ($1, $2, 'node', $3)",
    [id, `zz-fx17-${name}`, JSON.stringify({ version: "1.0", id, name: `zz-fx17-${name}`, runtime: "node", steps: [] })]
  );
  if (deployedBy !== null) {
    await pool.query(
      "INSERT INTO notebook_versions (id, notebook_id, document, deployed_by) VALUES ($1, $2, '{}', $3)",
      [`zz-fx17-v-${name}`, id, deployedBy]
    );
  }
  return id;
}

async function ownerOf(id: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT owner_id FROM notebooks WHERE id = $1", [id]);
  return rows[0].owner_id;
}

await legacySchema();
const firstCreator = await seedUser("m-first", "creator", "1900-01-01");
const secondCreator = await seedUser("m-second", "creator", "1900-01-02");
await seedUser("m-viewer", "viewer", "1900-01-03");

const byDeployer = await seedNotebook("m-by-deployer", "zz-fx17-m-second");
const byGhost = await seedNotebook("m-by-ghost", "zz-fx17-m-ghost");
const byViewer = await seedNotebook("m-by-viewer", "zz-fx17-m-viewer");
const byMigration = await seedNotebook("m-by-migration", "migration");

await pool.query("INSERT INTO secrets (id, key, value, is_secret) VALUES ('zz-fx17-s1', 'zz-fx17-API', 'v1', true)");
await pool.query("INSERT INTO secrets (id, key, value, is_secret) VALUES ('zz-fx17-s2', 'zz-fx17-PLAIN', 'v2', false)");
await pool.query(
  "INSERT INTO agent_tokens (id, label, scope, token_hash) VALUES ('zz-fx17-t1', 'zz-fx17-old-token', 'author', 'zz-fx17-hash')"
);

await initDb();

await check("D-8: the deployer of the oldest version owns it, when they are a creator", async () => {
  assert.equal(await ownerOf(byDeployer), secondCreator);
});

await check("D-8: a deployer who no longer exists, or is not a creator, falls back to the first creator", async () => {
  assert.equal(await ownerOf(byGhost), firstCreator);
  assert.equal(await ownerOf(byViewer), firstCreator);
  assert.equal(await ownerOf(byMigration), firstCreator);
});

await check("D-6: every existing secret was copied to every creator", async () => {
  const { rows } = await pool.query(
    "SELECT key, value, is_secret, owner_id FROM secrets WHERE key LIKE 'zz-fx17-%' ORDER BY key, owner_id"
  );
  assert.equal(rows.length, 4);
  for (const owner of [firstCreator, secondCreator]) {
    const mine = rows.filter((row) => row.owner_id === owner);
    assert.deepEqual(mine.map((row) => [row.key, row.value, row.is_secret]), [
      ["zz-fx17-API", "v1", true],
      ["zz-fx17-PLAIN", "v2", false],
    ]);
  }
});

await check("D-6: the same key may now exist once per owner, and only once", async () => {
  await assert.rejects(
    pool.query(
      "INSERT INTO secrets (id, key, value, is_secret, owner_id) VALUES ('zz-fx17-dup', 'zz-fx17-API', 'x', true, $1)",
      [firstCreator]
    ),
    /unique/i
  );
});

await check("D-9: an existing agent token goes to the first creator", async () => {
  const { rows } = await pool.query("SELECT user_id FROM agent_tokens WHERE id = 'zz-fx17-t1'");
  assert.equal(rows[0].user_id, firstCreator);
});

await check("initDb twice in a row changes nothing", async () => {
  const before = await pool.query("SELECT count(*)::int AS n FROM secrets WHERE key LIKE 'zz-fx17-%'");
  await initDb();
  await initDb();
  const after = await pool.query("SELECT count(*)::int AS n FROM secrets WHERE key LIKE 'zz-fx17-%'");
  assert.equal(after.rows[0].n, before.rows[0].n);
  assert.equal(await ownerOf(byDeployer), secondCreator);
});

await check("D-8 / D-6: with no creator at all the owner is NULL and no secret is deleted", async () => {
  await clean();
  await legacySchema();
  const creators = (await pool.query("UPDATE users SET role = 'viewer' WHERE role = 'creator' RETURNING id")).rows.map((row) => row.id as string);
  const lonely = await seedNotebook("m-lonely", "zz-fx17-nobody");
  await pool.query("INSERT INTO secrets (id, key, value, is_secret) VALUES ('zz-fx17-s3', 'zz-fx17-ORPHAN', 'v3', true)");
  await initDb();
  assert.equal(await ownerOf(lonely), null);
  const { rows } = await pool.query("SELECT owner_id FROM secrets WHERE key = 'zz-fx17-ORPHAN'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner_id, null);
  await pool.query("UPDATE users SET role = 'creator' WHERE id = ANY($1)", [creators]);
});

await clean();

console.log(`\n${passed} passed, ${failed} failed`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);

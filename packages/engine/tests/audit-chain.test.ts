/**
 * The audit trail as a data structure: append-only, hash-chained, pruned as a prefix, and
 * careful about what it is handed. What the engine *records* (and as whom) is
 * `audit-events.test.ts`; this file is about the table those rows live in.
 *
 * Tampering is done the only way the application's own database role can: the table's owner
 * switches the append-only trigger off for one transaction, changes a row, and switches it
 * back on. That is exactly the attacker the hash chain is for (somebody with the owner
 * credentials), as opposed to the trigger, which is for bugs and injected statements.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/audit-chain.test.ts
 */
import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { audit, canonicalRow, chainHash, GENESIS_HASH } from "../src/services/audit.service.js";
import { withContext } from "../src/core/request-context.js";

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
// A second run must be a no-op, not an error: the trigger and indexes are made idempotently.
await initDb();

/** Records one event as the engine and returns its row. */
async function write(action: string, meta: Record<string, unknown> = {}): Promise<Record<string, any>> {
  await withContext({ actor: { type: "system", component: "audit-test" } }, () => audit.record({ action, meta }));
  const { rows } = await pool.query("SELECT * FROM audit_events WHERE action = $1 ORDER BY id DESC LIMIT 1", [action]);
  return rows[0];
}

/** Runs `fn` with the append-only trigger off, on one connection, and always turns it back on. */
async function asTableOwner(fn: (q: (sql: string, params?: unknown[]) => Promise<any>) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only");
    try {
      await fn((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only");
    }
  } finally {
    client.release();
  }
}

console.log("\nappend-only");

await check("an UPDATE of an audit row is refused", async () => {
  const row = await write("test.append_only.update");
  await assert.rejects(
    () => pool.query("UPDATE audit_events SET action = 'test.rewritten' WHERE id = $1", [row.id]),
    /append-only/
  );
  const { rows } = await pool.query("SELECT action FROM audit_events WHERE id = $1", [row.id]);
  assert.equal(rows[0].action, "test.append_only.update");
});

await check("a DELETE is refused, with and without a WHERE", async () => {
  const row = await write("test.append_only.delete");
  await assert.rejects(() => pool.query("DELETE FROM audit_events WHERE id = $1", [row.id]), /append-only/);
  await assert.rejects(() => pool.query("DELETE FROM audit_events"), /append-only/);
});

await check("TRUNCATE is refused", async () => {
  await assert.rejects(() => pool.query("TRUNCATE audit_events"), /append-only/);
});

await check("the prune permission lives only inside the transaction that set it", async () => {
  const row = await write("test.append_only.flag");
  const client = await pool.connect();
  try {
    // Set for the session rather than the transaction: not what the engine does.
    await client.query("BEGIN");
    await client.query("SET LOCAL zaatool.audit_prune = 'on'");
    await client.query("COMMIT");
    // The permission ended with that transaction, and the connection goes back to the pool.
    await assert.rejects(() => client.query("DELETE FROM audit_events WHERE id = $1", [row.id]), /append-only/);

    // Inside a transaction that sets it, a DELETE goes through (and UPDATE still does not).
    await client.query("BEGIN");
    await client.query("SET LOCAL zaatool.audit_prune = 'on'");
    await assert.rejects(() => client.query("UPDATE audit_events SET action = 'x' WHERE id = $1", [row.id]), /append-only/);
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query("SET LOCAL zaatool.audit_prune = 'on'");
    const deleted = await client.query("DELETE FROM audit_events WHERE id = $1", [row.id]);
    await client.query("COMMIT");
    assert.equal(deleted.rowCount, 1);
  } finally {
    client.release();
  }
  // It was the newest row, so the chain is still whole.
  assert.equal((await audit.verifyChain()).ok, true);
});

console.log("\nhash chain");

await check("every row's hash covers its content and the previous hash", async () => {
  const first = await write("test.chain.a", { n: 1 });
  const second = await write("test.chain.b", { n: 2 });
  assert.equal(second.prev_hash, first.hash);
  assert.match(second.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(second.hash, first.hash);
});

await check("verifyChain accepts an intact trail", async () => {
  const verdict = await audit.verifyChain();
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  assert.ok(verdict.checked >= 2);
});

await check("an edited row is found, at the row", async () => {
  const victim = await write("test.chain.tamper", { amount: 1 });
  await write("test.chain.after", {});
  await asTableOwner(async (q) => {
    await q(`UPDATE audit_events SET meta = '{"amount": 2}'::jsonb WHERE id = $1`, [victim.id]);
  });
  try {
    const verdict = await audit.verifyChain();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.brokenAt?.id, String(victim.id));
    assert.equal(verdict.brokenAt?.reason, "hash-mismatch");
  } finally {
    await asTableOwner(async (q) => {
      await q(`UPDATE audit_events SET meta = $2::jsonb WHERE id = $1`, [victim.id, JSON.stringify(victim.meta)]);
    });
  }
  assert.equal((await audit.verifyChain()).ok, true, "restoring the row should restore the chain");
});

await check("a row removed from the middle is found", async () => {
  const before = await write("test.chain.gap.before", {});
  const middle = await write("test.chain.gap.middle", {});
  await write("test.chain.gap.after", {});

  const client = await pool.connect();
  try {
    await client.query("CREATE TEMP TABLE saved_row AS SELECT * FROM audit_events WHERE id = $1", [middle.id]);
    await client.query("BEGIN");
    await client.query("SET LOCAL zaatool.audit_prune = 'on'");
    await client.query("DELETE FROM audit_events WHERE id = $1", [middle.id]);
    await client.query("COMMIT");
    try {
      const verdict = await audit.verifyChain();
      assert.equal(verdict.ok, false);
      assert.equal(verdict.brokenAt?.reason, "chain-broken");
      assert.ok(BigInt(verdict.brokenAt!.id) > BigInt(before.id));
    } finally {
      await client.query("INSERT INTO audit_events SELECT * FROM saved_row");
    }
  } finally {
    client.release();
  }
  assert.equal((await audit.verifyChain()).ok, true);
});

await check("the hash does not depend on the order jsonb keeps keys in", async () => {
  // jsonb sorts keys by length then bytes; the canonical form must not care how they went in.
  const row = await write("test.chain.keys", { zebra: 1, a: { y: 2, b: 3 }, mm: [1, { q: 1, p: 2 }] });
  const { rows } = await pool.query("SELECT * FROM audit_events WHERE id = $1", [row.id]);
  const again = {
    ...rows[0],
    id: String(rows[0].id),
    occurred_at: new Date(rows[0].occurred_at).toISOString(),
    meta: { mm: [1, { p: 2, q: 1 }], a: { b: 3, y: 2 }, zebra: 1 },
  };
  assert.equal(chainHash(rows[0].prev_hash, again), rows[0].hash);
  assert.equal(
    canonicalRow(again),
    canonicalRow({ ...again, meta: { zebra: 1, a: { y: 2, b: 3 }, mm: [1, { q: 1, p: 2 }] } })
  );
});

await check("concurrent writers chain one after another, with no fork", async () => {
  const startedAfter = (await pool.query("SELECT coalesce(max(id), 0) AS id FROM audit_events")).rows[0].id;
  await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      withContext({ actor: { type: "system", component: "audit-test" } }, () =>
        audit.record({ action: "test.chain.concurrent", meta: { i } })
      )
    )
  );
  const { rows } = await pool.query(
    "SELECT id, prev_hash, hash FROM audit_events WHERE id > $1 ORDER BY id ASC",
    [startedAfter]
  );
  assert.equal(rows.length, 40);
  assert.equal(new Set(rows.map((r) => r.prev_hash)).size, 40, "two rows share a predecessor: the chain forked");
  for (let i = 1; i < rows.length; i += 1) assert.equal(rows[i].prev_hash, rows[i - 1].hash);
  assert.equal((await audit.verifyChain()).ok, true);
});

console.log("\nwhat is written");

await check("secret-looking keys in meta are redacted, names are kept", async () => {
  const row = await write("test.meta.scrub", {
    name: "STRIPE_KEY",
    password: "hunter2-very-secret",
    token: "zaa_abcdef",
    slug: "a-webhook-slug-value",
    nested: { apiKey: "key-value-1234", note: "fine" },
    tokenId: "row-id-is-not-a-credential",
  });
  const text = JSON.stringify(row.meta);
  assert.ok(!text.includes("hunter2"), text);
  assert.ok(!text.includes("zaa_abcdef"), text);
  assert.ok(!text.includes("a-webhook-slug-value"), text);
  assert.ok(!text.includes("key-value-1234"), text);
  assert.equal(row.meta.name, "STRIPE_KEY");
  assert.equal(row.meta.nested.note, "fine");
  assert.equal(row.meta.tokenId, "row-id-is-not-a-credential");
});

await check("control characters cannot forge structure in text columns", async () => {
  const row = await write("test.text.clean", { label: "a\nb\u0000c" });
  assert.equal(row.meta.label, "a b c");
});

await check("an oversized meta is replaced by a marker, not stored", async () => {
  const row = await write("test.meta.big", { blob: "x".repeat(3000), more: Array.from({ length: 50 }, () => "y".repeat(3000)) });
  assert.deepEqual(row.meta, { truncated: true });
});

await check("a write that cannot be made is swallowed after being logged, and does not throw", async () => {
  // A BigInt cannot be serialised, so the event fails inside `record`.
  const before = (await pool.query("SELECT count(*)::int AS n FROM audit_events")).rows[0].n;
  await audit.record({ action: "test.write_failed", meta: { n: 1n as unknown as number } });
  const after = (await pool.query("SELECT count(*)::int AS n FROM audit_events")).rows[0].n;
  assert.equal(after, before);
});

await check("a burst of refusals from one address is rationed, successes are not", async () => {
  for (let i = 0; i < 30; i += 1) await audit.record({ action: "test.ration.denied", outcome: "denied" });
  const denied = (await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'test.ration.denied'")).rows[0].n;
  assert.equal(denied, 20);
  for (let i = 0; i < 30; i += 1) await audit.record({ action: "test.ration.ok" });
  const ok = (await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'test.ration.ok'")).rows[0].n;
  assert.equal(ok, 30);
});

console.log("\nretention");

await check("pruning removes a prefix, keeps the newest row, and the chain verifies from the anchor", async () => {
  await write("test.prune.old.1");
  await write("test.prune.old.2");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const cut = new Date();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await write("test.prune.new.1");
  const newest = await write("test.prune.new.2");

  // "Now" a day after the cut with a one-day retention puts the cutoff exactly at `cut`.
  const result = await audit.prune(1, new Date(cut.getTime() + 24 * 60 * 60 * 1000));
  assert.ok(result.deleted >= 2, `deleted ${result.deleted}`);

  const { rows: left } = await pool.query("SELECT id, occurred_at, prev_hash FROM audit_events ORDER BY id ASC");
  assert.ok(left.every((r) => new Date(r.occurred_at) >= cut || String(r.id) === String(newest.id)));
  assert.equal(left.some((r) => String(r.id) === String(newest.id)), true, "the newest row was pruned");

  const verdict = await audit.verifyChain();
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  assert.notEqual(verdict.anchor, GENESIS_HASH, "after a prune the oldest row points at a removed one");
  assert.equal(verdict.anchor, left[0].prev_hash);

  // The prune itself is in the trail, as the engine.
  const { rows: note } = await pool.query(
    "SELECT actor_type, component, meta FROM audit_events WHERE action = 'audit.prune' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(note[0].actor_type, "system");
  assert.equal(note[0].component, "audit-retention");
  assert.equal(note[0].meta.deleted, result.deleted);
});

await check("the chain carries on from the anchor after a prune", async () => {
  await write("test.prune.after");
  assert.equal((await audit.verifyChain()).ok, true);
});

await check("a retention of 0 days keeps everything", async () => {
  const before = (await pool.query("SELECT count(*)::int AS n FROM audit_events")).rows[0].n;
  const result = await audit.prune(0, new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000));
  assert.equal(result.deleted, 0);
  const after = (await pool.query("SELECT count(*)::int AS n FROM audit_events")).rows[0].n;
  assert.equal(after, before);
});

await pool.end();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

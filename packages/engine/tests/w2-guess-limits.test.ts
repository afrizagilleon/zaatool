/**
 * C-17 — what an anonymous caller may make this engine spend.
 *
 * A shared page's password was compared with bcrypt on every attempt, with no limit: guessing
 * was free and each guess occupied one of the four threads bcrypt shares with the rest of the
 * process. And the webhook limiter asked the database whether a request was authenticated
 * (three queries) *before* counting it, so a flood of unauthenticated requests was paid for
 * in full and counted afterwards.
 *
 * Clients are told apart by `X-Forwarded-For`, which the engine honours from a loopback peer
 * by default, so each case uses an address of its own and the counters of one do not leak
 * into the next.
 *
 * Everything it makes is prefixed `zz-w2lim-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test w2-guess-limits
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookSharesService } from "../src/services/notebook-shares.service.js";
import { notebookTriggersService } from "../src/services/notebook-triggers.service.js";
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
const owner = (await testOwner("w2lim")).id;

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function clean(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-w2lim-%'");
  for (const row of rows) {
    await pool.query("DELETE FROM notebook_shares WHERE notebook_id = $1", [row.id]);
    await notebooksService.delete(row.id).catch(() => undefined);
  }
}
await clean();

const deployed = async (name: string, extra: Record<string, unknown> = {}): Promise<string> => {
  const { id } = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      name,
      runtime: "node",
      inputs: [{ name: "n", type: "number", default: 1 }],
      outputs: ["n"],
      steps: [{ id: "c1", kind: "cell", code: "return { n: inputs.n };" }],
      ...extra,
    },
    "test",
    owner
  );
  await notebooksService.deploy(id, "test");
  return id;
};

const guess = (token: string, password: string, from: string) =>
  fetch(`${base}/api/shared/${token}`, { headers: { "X-Share-Password": password, "X-Forwarded-For": from } });

console.log("\nguessing a shared page's password");

await check("past the limit a client is refused before any password is compared", async () => {
  process.env.SHARE_PASSWORD_IP_MAX = "5";
  process.env.SHARE_PASSWORD_LINK_MAX = "1000";
  try {
    const share = await notebookSharesService.create(await deployed("zz-w2lim-ip"), "test", "right-password");
    let comparisons = 0;
    const real = notebookSharesService.checkPassword.bind(notebookSharesService);
    notebookSharesService.checkPassword = async (...args) => {
      comparisons += 1;
      return real(...args);
    };
    let statuses: number[];
    try {
      statuses = await Promise.all(Array.from({ length: 30 }, () => guess(share.token!, "wrong", "198.51.100.10").then((r) => r.status)));
    } finally {
      notebookSharesService.checkPassword = real;
    }
    assert.equal(statuses.filter((s) => s === 401).length, 5, JSON.stringify(statuses));
    assert.equal(statuses.filter((s) => s === 429).length, 25);
    assert.equal(comparisons, 5, `${comparisons} bcrypt comparisons ran for 30 guesses`);

    // Another client is not held to the first one's count.
    assert.equal((await guess(share.token!, "wrong", "198.51.100.11")).status, 401);
  } finally {
    delete process.env.SHARE_PASSWORD_IP_MAX;
    delete process.env.SHARE_PASSWORD_LINK_MAX;
  }
});

await check("one link is limited across every address, and another link is not", async () => {
  process.env.SHARE_PASSWORD_IP_MAX = "1000";
  process.env.SHARE_PASSWORD_LINK_MAX = "3";
  try {
    const targeted = await notebookSharesService.create(await deployed("zz-w2lim-link-a"), "test", "right-password");
    const other = await notebookSharesService.create(await deployed("zz-w2lim-link-b"), "test", "right-password");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await guess(targeted.token!, "wrong", `203.0.113.${20 + i}`)).status);
    assert.deepEqual(statuses, [401, 401, 401, 429, 429, 429]);
    assert.equal((await guess(other.token!, "wrong", "203.0.113.30")).status, 401);
  } finally {
    delete process.env.SHARE_PASSWORD_IP_MAX;
    delete process.env.SHARE_PASSWORD_LINK_MAX;
  }
});

await check("the right password never uses up the allowance, and opening to be asked is not a guess", async () => {
  process.env.SHARE_PASSWORD_IP_MAX = "2";
  process.env.SHARE_PASSWORD_LINK_MAX = "2";
  try {
    const share = await notebookSharesService.create(await deployed("zz-w2lim-ok"), "test", "right-password");
    for (let i = 0; i < 8; i += 1) {
      const res = await fetch(`${base}/api/shared/${share.token}`, {
        headers: { "X-Share-Password": "right-password", "X-Forwarded-For": "192.0.2.40" },
      });
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    for (let i = 0; i < 8; i += 1) {
      const res = await fetch(`${base}/api/shared/${share.token}`, { headers: { "X-Forwarded-For": "192.0.2.40" } });
      assert.equal(res.status, 401, "asking for the page is being counted as a guess");
    }
    assert.equal((await guess(share.token!, "wrong", "192.0.2.40")).status, 401);
  } finally {
    delete process.env.SHARE_PASSWORD_IP_MAX;
    delete process.env.SHARE_PASSWORD_LINK_MAX;
  }
});

console.log("\nthe webhook limiter counts before it asks the database");

await check("a flood of unauthenticated requests is refused without a lookup per request", async () => {
  process.env.HOOK_RATE_LIMIT_MAX = "3";
  try {
    const slug = "zz-w2lim-hook-0123456789abcdefghij";
    await deployed("zz-w2lim-hook", { triggers: [{ id: "zz-w2lim-t", kind: "webhook", slug, enabled: true }] });

    let lookups = 0;
    const real = notebookTriggersService.findEnabledWebhook.bind(notebookTriggersService);
    notebookTriggersService.findEnabledWebhook = async (...args) => {
      lookups += 1;
      return real(...args);
    };
    let statuses: number[];
    try {
      statuses = [];
      for (let i = 0; i < 30; i += 1) {
        statuses.push((await fetch(`${base}/hooks/${slug}`, { method: "POST", headers: { "X-Forwarded-For": "198.51.100.50" } })).status);
      }
    } finally {
      notebookTriggersService.findEnabledWebhook = real;
    }
    assert.equal(statuses.filter((s) => s === 200).length, 3, JSON.stringify(statuses));
    assert.equal(statuses.filter((s) => s === 429).length, 27);
    // The three that were let through look the hook up once each, to run it. Nothing else does.
    assert.equal(lookups, 3, `${lookups} database lookups for 30 requests`);
  } finally {
    delete process.env.HOOK_RATE_LIMIT_MAX;
  }
});

await check("a flood that only claims to carry a secret is cut off by the count, not checked forever", async () => {
  process.env.HOOK_RATE_LIMIT_MAX = "1";
  try {
    const slug = "zz-w2lim-hook2-0123456789abcdefghij";
    await deployed("zz-w2lim-hook2", { triggers: [{ id: "zz-w2lim-t2", kind: "webhook", slug, secretKey: "ZZ_W2LIM_NONE", enabled: true }] });

    let lookups = 0;
    const real = notebookTriggersService.findEnabledWebhook.bind(notebookTriggersService);
    notebookTriggersService.findEnabledWebhook = async (...args) => {
      lookups += 1;
      return real(...args);
    };
    // The engine says, for every request, that the secret this hook names does not exist.
    const realError = console.error;
    console.error = () => {};
    try {
      for (let i = 0; i < 60; i += 1) {
        await fetch(`${base}/hooks/${slug}`, {
          method: "POST",
          headers: { "X-Forwarded-For": "198.51.100.60", "X-Webhook-Secret": `guess-${i}` },
        });
      }
    } finally {
      console.error = realError;
      notebookTriggersService.findEnabledWebhook = real;
    }
    // Checked while within 20 times the limit, and not once beyond it.
    assert.ok(lookups <= 21 * 2, `${lookups} lookups for 60 forged requests`);
  } finally {
    delete process.env.HOOK_RATE_LIMIT_MAX;
  }
});

server.close();
await clean();
await dropOwner("w2lim");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * What the engine writes to the audit trail, and as whom.
 *
 * Every way into the engine is exercised for real — a signed-in browser (HTTP), an MCP
 * client (a real Streamable HTTP session that says who it is), a webhook, a share link, the
 * scheduler and a command-line script — and the question asked of each is the same: does the
 * row name the right actor, the right target, and no secret?
 *
 * Everything this makes is prefixed `zz-aud-`. Audit rows themselves cannot be deleted (that
 * is the point of them), so nothing here cleans the trail; the tests look rows up by the ids
 * they just created.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/audit-events.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/server/app.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";
import { secretsService } from "../src/services/secrets.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookExecutionService } from "../src/services/notebook-execution.service.js";
import { notebookAccessService } from "../src/services/notebook-access.service.js";
import { notebookSharesService } from "../src/services/notebook-shares.service.js";
import { SchedulerService } from "../src/services/scheduler.service.js";
import { audit } from "../src/services/audit.service.js";
import { asOperator } from "../scripts/operator-context.js";
import { testOwner, dropOwner } from "./owners.js";

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
    console.log(`       ${((err as Error).stack ?? (err as Error).message).split("\n").slice(0, 6).join("\n       ")}`);
  }
}

const PASSWORD = "zz-owner-password-long";
// Trigger ids are unique per deployment and audit rows are forever, so reruns need fresh ones.
const RUN = Date.now().toString(36);

await initDb();
await pool.query("DELETE FROM users WHERE username LIKE 'zz-aud-%'");
// What an interrupted earlier run left behind.
for (const row of (await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-aud-%'")).rows) {
  await notebooksService.delete(row.id).catch(() => {});
}
await pool.query("DELETE FROM agent_tokens WHERE label LIKE 'zz-aud-%'");

const A = await testOwner("audA");
const B = await testOwner("audB");
async function makeViewer(name: string) {
  const user = await authService.createUser(`zz-aud-${name}`, PASSWORD, "viewer");
  return { id: user.id, username: user.username, token: (await authService.login(user.username, PASSWORD)).token };
}
const V = await makeViewer("viewer");
const W = await makeViewer("other");

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

interface Reply {
  status: number;
  json: any;
  headers: Headers;
}

async function api(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<Reply> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      // Login and register need this whoever asks; the rest do not mind it.
      "x-zaatool-request": "1",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json, headers: response.headers };
}

/** Audit rows by action, newest first, optionally narrowed in SQL. */
async function events(action: string, where = "TRUE", params: unknown[] = []): Promise<Record<string, any>[]> {
  // `where` is written with $1.. for its own parameters; the action takes the first slot.
  const shifted = where.replace(/\$(\d+)/g, (_match, n: string) => `$${Number(n) + 1}`);
  const { rows } = await pool.query(
    `SELECT * FROM audit_events WHERE action = $1 AND (${shifted}) ORDER BY id DESC`,
    [action, ...params]
  );
  return rows;
}

async function one(action: string, where: string, params: unknown[]): Promise<Record<string, any>> {
  const rows = await events(action, where, params);
  assert.ok(rows.length > 0, `no ${action} event for ${JSON.stringify(params)}`);
  return rows[0];
}

/** How many audit rows, anywhere in any column, contain this text. */
async function mentions(needle: string): Promise<number> {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM audit_events a WHERE a::text LIKE $1", [`%${needle}%`]);
  return rows[0].n;
}

function doc(name: string, extra: Record<string, unknown> = {}) {
  return {
    version: "1.0",
    id: "",
    name,
    runtime: "node",
    steps: [{ id: "c1", kind: "cell", code: "return { ok: 1 };" }],
    ...extra,
  };
}

async function runStatus(runId: string, ms = 20_000): Promise<Record<string, any>> {
  const end = Date.now() + ms;
  for (;;) {
    const { rows } = await pool.query("SELECT * FROM notebook_runs WHERE id = $1", [runId]);
    if (rows[0] && rows[0].status !== "running") return rows[0];
    if (Date.now() > end) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function lastRun(notebookId: string): Promise<Record<string, any>> {
  const { rows } = await pool.query("SELECT * FROM notebook_runs WHERE notebook_id = $1 ORDER BY started_at DESC LIMIT 1", [notebookId]);
  assert.ok(rows[0], "no run recorded");
  return rows[0];
}

const notebooks: string[] = [];

console.log("\nsession (browser)");

await check("a failed sign-in is recorded as anonymous, names the account it was aimed at, and not the password", async () => {
  const wrong = "wrong-password-zz-aud-needle";
  const reply = await api("POST", "/api/auth/login", { body: { username: A.username, password: wrong } });
  assert.equal(reply.status, 401);
  const row = await one("auth.login", "outcome = 'failure' AND target_id = $1", [A.id]);
  assert.equal(row.actor_type, "anonymous");
  assert.equal(row.meta.reason, "bad_password");
  assert.equal(row.meta.attempted, A.username);
  assert.equal(row.target_owner_id, A.id);
  assert.equal(await mentions(wrong), 0, "a password reached the audit trail");
});

await check("an unknown account is recorded too, without an id", async () => {
  await api("POST", "/api/auth/login", { body: { username: "zz-aud-nobody", password: "whatever-password-123" } });
  const row = await one("auth.login", "outcome = 'failure' AND meta->>'attempted' = 'zz-aud-nobody'", []);
  assert.equal(row.meta.reason, "unknown_user");
  assert.equal(row.target_id, null);
  assert.equal(row.meta.knownAccount, false);
});

await check("a sign-in is the user's, with the address and the request id of the request", async () => {
  const reply = await api("POST", "/api/auth/login", { body: { username: A.username, password: PASSWORD } });
  assert.equal(reply.status, 200);
  const requestId = reply.headers.get("x-request-id");
  assert.ok(requestId);
  const row = await one("auth.login", "outcome = 'success' AND request_id = $1", [requestId]);
  assert.equal(row.actor_type, "user");
  assert.equal(row.user_id, A.id);
  assert.equal(row.username, A.username);
  assert.ok(row.ip, "no address");
  assert.equal(await mentions(PASSWORD), 0);
});

await check("every authenticated request names its user: a notebook created over REST", async () => {
  const saved = await api("POST", "/api/notebooks", { token: A.token, body: doc("zz-aud-nb-main") });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  notebooks.push(saved.json.id);
  const row = await one("notebook.create", "target_id = $1", [saved.json.id]);
  assert.equal(row.actor_type, "user");
  assert.equal(row.user_id, A.id);
  assert.equal(row.target_type, "notebook");
  assert.equal(row.target_owner_id, A.id);
  assert.equal(row.target_name, "zz-aud-nb-main");
  assert.equal(row.request_id, saved.headers.get("x-request-id"));
  assert.equal(row.meta.revision, 1);
});

let MAIN = notebooks[0];

await check("a save, a deploy and an undeploy are recorded with the revision they were made at", async () => {
  const current = (await api("GET", `/api/notebooks/${MAIN}`, { token: A.token })).json;
  const saved = await api("POST", "/api/notebooks", { token: A.token, body: { ...current, name: "zz-aud-nb-main" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const save = await one("notebook.save", "target_id = $1", [MAIN]);
  assert.equal(save.meta.revision, saved.json.revision);
  assert.equal(save.meta.previousRevision, saved.json.revision - 1);
  assert.equal(save.user_id, A.id);

  const deployed = await api("POST", `/api/notebooks/${MAIN}/deploy`, { token: A.token });
  assert.equal(deployed.status, 200, JSON.stringify(deployed.json));
  const deploy = await one("notebook.deploy", "target_id = $1", [MAIN]);
  assert.equal(deploy.meta.versionId, deployed.json.versionId);
  assert.equal(deploy.user_id, A.id);

  // The version row names the person by id as well as by name (G2).
  const { rows } = await pool.query("SELECT deployed_by, deployed_by_user_id FROM notebook_versions WHERE id = $1", [deployed.json.versionId]);
  assert.equal(rows[0].deployed_by, A.username);
  assert.equal(rows[0].deployed_by_user_id, A.id);

  const undeployed = await api("DELETE", `/api/notebooks/${MAIN}/deploy`, { token: A.token });
  assert.equal(undeployed.status, 200);
  const undeploy = await one("notebook.undeploy", "target_id = $1", [MAIN]);
  assert.equal(undeploy.user_id, A.id);
  await api("POST", `/api/notebooks/${MAIN}/deploy`, { token: A.token });
});

await check("a cell written in the editor is authored as a user, by id", async () => {
  const current = (await api("GET", `/api/notebooks/${MAIN}`, { token: A.token })).json;
  const author = current.steps[0].author;
  assert.equal(author.by, A.username);
  assert.equal(author.kind, "user");
  assert.equal(author.userId, A.id);
  assert.equal(author.tokenId, undefined);
});

await check("a run from the UI says it came from a user", async () => {
  const started = await api("POST", `/api/notebooks/${MAIN}/run`, { token: A.token, body: {} });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const run = await runStatus(started.json.runId);
  assert.equal(run.actor_type, "user");
  assert.equal(run.started_by, A.id);
  assert.equal(run.agent_token_id, null);
  assert.equal(run.agent_client, null);
  assert.equal(run.trigger_id, null);
  // And the API hands the new fields to whoever may read the run.
  const listed = await api("GET", `/api/notebooks/${MAIN}/runs`, { token: A.token });
  const mine = listed.json.find((r: any) => r.id === started.json.runId);
  assert.equal(mine.actor_type, "user");
  assert.ok("agent_token_id" in mine && "agent_client" in mine && "trigger_id" in mine);
});

await check("sign-out, sign-out-everywhere and a password change name the person", async () => {
  const pw = await makeViewer("pw");
  // Each call below ends the session it was made with, so each gets a fresh one.
  const login = async () => (await api("POST", "/api/auth/login", { body: { username: pw.username, password: PASSWORD } })).json.token as string;

  let token = await login();
  assert.equal((await api("POST", "/api/auth/logout", { token })).status, 200);
  const out = await one("auth.logout", "user_id = $1", [pw.id]);
  assert.equal(out.actor_type, "user");

  token = await login();
  assert.equal((await api("POST", "/api/auth/logout-all", { token })).status, 200);
  assert.equal((await one("auth.logout_all", "target_id = $1", [pw.id])).user_id, pw.id);

  token = await login();
  const changed = await api("POST", "/api/auth/me/password", {
    token,
    body: { currentPassword: PASSWORD, newPassword: "another-long-password-zz-aud-new" },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const change = await one("auth.password_change", "target_id = $1 AND outcome = 'success'", [pw.id]);
  assert.equal(change.user_id, pw.id);
  assert.equal(change.meta.via, "self");
  assert.equal(await mentions("another-long-password-zz-aud-new"), 0);

  const wrong = await api("POST", "/api/auth/me/password", {
    token: (changed.json.token as string),
    body: { currentPassword: "not-the-password-at-all", newPassword: "yet-another-long-password-zz" },
  });
  assert.equal(wrong.status, 400);
  assert.equal((await one("auth.password_change", "target_id = $1 AND outcome = 'failure'", [pw.id])).meta.reason, "current_password_incorrect");
});

await check("inviting, deactivating and activating a user are recorded against the creator", async () => {
  const invited = await api("POST", "/api/auth/users", {
    token: A.token,
    body: { username: "zz-aud-invited", password: PASSWORD, role: "viewer" },
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.json));
  const id = invited.json.user.id;
  const created = await one("user.create", "target_id = $1", [id]);
  assert.equal(created.user_id, A.id);
  assert.equal(created.meta.role, "viewer");

  await api("PATCH", `/api/auth/users/${id}`, { token: A.token, body: { active: false } });
  const off = await one("user.deactivate", "target_id = $1", [id]);
  assert.equal(off.user_id, A.id);
  assert.equal(off.target_owner_id, id);
  await api("PATCH", `/api/auth/users/${id}`, { token: A.token, body: { active: true } });
  assert.equal((await one("user.activate", "target_id = $1", [id])).user_id, A.id);
});

await check("registration while closed is refused and recorded as denied", async () => {
  const reply = await api("POST", "/api/auth/register", { body: { username: "zz-aud-closed", password: PASSWORD } });
  assert.equal(reply.status, 403);
  const row = await one("auth.register", "outcome = 'denied' AND meta->>'attempted' = 'zz-aud-closed'", []);
  assert.equal(row.actor_type, "anonymous");
});

await check("a creator-only route refused to a viewer is recorded against the viewer", async () => {
  const reply = await api("POST", "/api/notebooks", { token: V.token, body: doc("zz-aud-viewer-write") });
  assert.equal(reply.status, 403);
  const row = await one("authz.denied", "user_id = $1", [V.id]);
  assert.equal(row.outcome, "denied");
  assert.equal(row.meta.method, "POST");
  assert.equal(row.meta.route, "/api/notebooks/");
});

console.log("\nsecrets");

await check("secret changes record the key and the owner, never the value", async () => {
  const value = "S3CR3T-VALUE-zz-aud-9f8e7d";
  const created = await api("POST", "/api/resources/secrets", { token: A.token, body: { key: "ZZ_AUD_KEY", value, is_secret: true } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const id = created.json.id;
  const create = await one("secret.create", "target_id = $1", [id]);
  assert.equal(create.target_name, "ZZ_AUD_KEY");
  assert.equal(create.target_owner_id, A.id);
  assert.equal(create.user_id, A.id);

  await api("PUT", `/api/resources/secrets/${id}`, { token: A.token, body: { key: "ZZ_AUD_KEY2", value: `${value}-new`, is_secret: true } });
  const update = await one("secret.update", "target_id = $1", [id]);
  assert.equal(update.target_name, "ZZ_AUD_KEY2");
  assert.equal(update.meta.renamedFrom, "ZZ_AUD_KEY");

  await api("DELETE", `/api/resources/secrets/${id}`, { token: A.token });
  assert.equal((await one("secret.delete", "target_id = $1", [id])).target_name, "ZZ_AUD_KEY2");

  assert.equal(await mentions("S3CR3T-VALUE"), 0, "a secret value reached the audit trail");
});

console.log("\nagent (MCP)");

const issued = await api("POST", "/api/agent-tokens", { token: A.token, body: { label: "zz-aud-claude", scope: "author" } });
const agentToken: string = issued.json.token;
const agentTokenId: string = issued.json.record.id;

await check("issuing a token is recorded without the token", async () => {
  const row = await one("agent_token.issue", "target_id = $1", [agentTokenId]);
  assert.equal(row.user_id, A.id);
  assert.equal(row.target_owner_id, A.id);
  assert.equal(row.meta.scope, "author");
  assert.equal(await mentions(agentToken), 0, "the token reached the audit trail");
});

const mcpUrl = new URL(`${base}/mcp`);
async function connect(token: string, name = "zz-aud-client", version = "9.9.9"): Promise<Client> {
  const client = new Client({ name, version });
  await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}
const opened: Client[] = [];
let agentNotebook = "";

await check("an MCP session records the client it said it was, against the token", async () => {
  const client = await connect(agentToken);
  opened.push(client);
  const row = await one("agent.session_start", "token_id = $1", [agentTokenId]);
  assert.equal(row.actor_type, "agent");
  assert.equal(row.client, "zz-aud-client/9.9.9");
  assert.equal(row.user_id, A.id);
  assert.equal(row.username, A.username);
  assert.equal(row.label, "zz-aud-claude");
  assert.equal(row.target_id, agentTokenId);
  assert.equal(row.target_owner_id, A.id, "the token's owner should be able to see their agent's sessions");
});

await check("a cell an agent writes is authored by the token, typed apart from a user of the same name", async () => {
  const client = opened[0];
  const written = (await client.callTool({
    name: "notebook_write",
    arguments: { text: ["---", "name: zz-aud-agent-nb", "runtime: node", "outputs: [answer]", "---", "", "```js", "return { answer: 1 };", "```"].join("\n") },
  })) as { content: { text: string }[]; isError?: boolean };
  const text = written.content.map((p) => p.text).join("\n");
  assert.ok(!written.isError, text);
  agentNotebook = /`([0-9a-f-]{36})`/.exec(text)![1];
  notebooks.push(agentNotebook);

  const { rows } = await pool.query("SELECT document FROM notebooks WHERE id = $1", [agentNotebook]);
  const author = JSON.parse(rows[0].document).steps[0].author;
  assert.equal(author.by, "zz-aud-claude");
  assert.equal(author.kind, "agent");
  assert.equal(author.tokenId, agentTokenId);
  assert.equal(author.userId, A.id);

  const row = await one("notebook.create", "target_id = $1", [agentNotebook]);
  assert.equal(row.actor_type, "agent");
  assert.equal(row.token_id, agentTokenId);
  assert.equal(row.client, "zz-aud-client/9.9.9", "the client must follow the session to later requests");
  assert.equal(row.target_owner_id, A.id);
});

await check("an MCP run is told apart from the same account pressing Run, and names token and client", async () => {
  const client = opened[0];
  const ran = (await client.callTool({ name: "notebook_run", arguments: { notebook: "zz-aud-agent-nb" } })) as { content: { text: string }[] };
  assert.equal(JSON.parse(ran.content.map((p) => p.text).join("\n")).status, "success");
  const run = await lastRun(agentNotebook);
  assert.equal(run.actor_type, "agent");
  assert.equal(run.agent_token_id, agentTokenId);
  assert.equal(run.agent_client, "zz-aud-client/9.9.9");
  assert.equal(run.started_by, A.id, "started_by is still the person the token acts for");

  const listed = (await client.callTool({ name: "run_list", arguments: { notebook: "zz-aud-agent-nb" } })) as { content: { text: string }[] };
  const rows = JSON.parse(listed.content.map((p) => p.text).join("\n"));
  assert.equal(rows[0].actor_type, "agent");
  assert.equal(rows[0].agent_client, "zz-aud-client/9.9.9");
});

await check("a client that sends control characters in its name is recorded cleaned and capped", async () => {
  const client = await connect(agentToken, `zz-aud\nforged ${"x".repeat(200)}`, "1.0");
  opened.push(client);
  const rows = await events("agent.session_start", "token_id = $1", [agentTokenId]);
  const latest = rows[0].client as string;
  assert.ok(!/[\n\r]/.test(latest));
  assert.ok(latest.length <= 64 + 1 + 32, `client too long: ${latest.length}`);
});

await check("revoking a token is recorded, and the refused connections name why", async () => {
  const revoked = await api("DELETE", `/api/agent-tokens/${agentTokenId}`, { token: A.token });
  assert.equal(revoked.status, 200);
  assert.equal((await one("agent_token.revoke", "target_id = $1", [agentTokenId])).user_id, A.id);

  await assert.rejects(() => connect(agentToken), /401|Unauthorized|Unknown or revoked/i);
  const afterRevoke = await one("agent.auth_failed", "target_id = $1", [agentTokenId]);
  assert.equal(afterRevoke.outcome, "denied");
  assert.equal(afterRevoke.meta.reason, "revoked_token");
  assert.equal(afterRevoke.target_owner_id, A.id);
  assert.equal(afterRevoke.actor_type, "anonymous");

  await assert.rejects(() => connect("zaa_0000000000000000"), /401|Unauthorized|Unknown or revoked/i);
  const unknown = await one("agent.auth_failed", "meta->>'reason' = 'unknown_token'", []);
  assert.equal(unknown.target_id, null);
  assert.equal(await mentions("zaa_0000000000000000"), 0);
  assert.equal(await mentions(agentToken), 0);
});

console.log("\nwebhook, share, schedule");

const SLUG = "zz-aud-slug-0123456789abcdefghij";
const SECRET_SLUG = "zz-aud-slug-secret-9876543210abcd";
let hookNotebook = "";
let secretHookNotebook = "";

await check("a webhook is the trigger's, not the slug's: actor, run and event all name the trigger", async () => {
  const saved = await api("POST", "/api/notebooks", {
    token: A.token,
    body: doc("zz-aud-hook", { triggers: [{ id: `zz-aud-trg-open-${RUN}`, kind: "webhook", slug: SLUG }] }),
  });
  hookNotebook = saved.json.id;
  notebooks.push(hookNotebook);
  assert.equal((await api("POST", `/api/notebooks/${hookNotebook}/deploy`, { token: A.token })).status, 200);

  const reply = await api("POST", `/hooks/${SLUG}`, { body: { hello: "world" } });
  assert.ok([200, 202].includes(reply.status), JSON.stringify(reply.json));
  const run = await runStatus(reply.json.runId);
  assert.equal(run.actor_type, "webhook");
  assert.equal(run.trigger_id, `zz-aud-trg-open-${RUN}`);
  assert.equal(run.started_by, null);

  const row = await one("webhook.received", "trigger_id = $1 AND outcome = 'success'", [`zz-aud-trg-open-${RUN}`]);
  assert.equal(row.actor_type, "webhook");
  assert.equal(row.actor_notebook_id, hookNotebook);
  assert.equal(row.target_id, hookNotebook);
  assert.equal(row.target_owner_id, A.id);
  assert.equal(row.meta.runId, reply.json.runId);
  assert.equal(await mentions(SLUG), 0, "a webhook slug reached the audit trail");
});

await check("an unknown hook and a hook with the wrong secret are refused and recorded", async () => {
  const unknown = await api("POST", "/hooks/zz-aud-nothing-here-0123456789", { body: {} });
  assert.equal(unknown.status, 404);
  assert.equal((await one("webhook.received", "outcome = 'failure' AND meta->>'reason' = 'unknown_webhook'", [])).actor_type, "anonymous");

  await secretsService.create(A.id, "ZZ_AUD_HOOK_SECRET", "hook-secret-value-zz-aud", true);
  const saved = await api("POST", "/api/notebooks", {
    token: A.token,
    body: doc("zz-aud-hook-secret", { triggers: [{ id: `zz-aud-trg-secret-${RUN}`, kind: "webhook", slug: SECRET_SLUG, secretKey: "ZZ_AUD_HOOK_SECRET" }] }),
  });
  secretHookNotebook = saved.json.id;
  notebooks.push(secretHookNotebook);
  await api("POST", `/api/notebooks/${secretHookNotebook}/deploy`, { token: A.token });

  const bad = await api("POST", `/hooks/${SECRET_SLUG}`, { body: {}, headers: { "x-webhook-secret": "guess-zz-aud-needle" } });
  assert.equal(bad.status, 401);
  const row = await one("webhook.received", `trigger_id = 'zz-aud-trg-secret-${RUN}' AND outcome = 'denied'`, []);
  assert.equal(row.meta.reason, "bad_secret");
  assert.equal(row.actor_type, "webhook");
  assert.equal(await mentions("guess-zz-aud-needle"), 0);
  assert.equal(await mentions("hook-secret-value-zz-aud"), 0);

  const good = await api("POST", `/hooks/${SECRET_SLUG}`, { body: {}, headers: { "x-webhook-secret": "hook-secret-value-zz-aud" } });
  assert.ok([200, 202].includes(good.status));
  await runStatus(good.json.runId);
  assert.equal((await events("webhook.received", `trigger_id = 'zz-aud-trg-secret-${RUN}' AND outcome = 'success'`)).length, 1);
});

await check("a share link: creation, a wrong password and a run are attributed to the link, never its token", async () => {
  const created = await api("POST", `/api/notebooks/${MAIN}/shares`, { token: A.token, body: { password: "share-pw-zz-aud-1" } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const shareToken: string = created.json.token;
  const shareId: string = created.json.id;
  const make = await one("share.create", "meta->>'shareId' = $1", [shareId]);
  assert.equal(make.user_id, A.id);
  assert.equal(make.target_id, MAIN);
  assert.equal(make.meta.protected, true);
  const { rows: share } = await pool.query("SELECT created_by, created_by_user_id FROM notebook_shares WHERE id = $1", [shareId]);
  assert.equal(share[0].created_by, A.username);
  assert.equal(share[0].created_by_user_id, A.id);

  const wrong = await api("POST", `/api/shared/${shareToken}/run`, { body: {}, headers: { "x-share-password": "guess-share-zz-aud-needle" } });
  assert.equal(wrong.status, 401);
  const failure = await one("share.password_failed", "share_id = $1", [shareId]);
  assert.equal(failure.actor_type, "share");
  assert.equal(failure.actor_notebook_id, MAIN);
  assert.equal(failure.outcome, "failure");
  assert.equal(failure.target_owner_id, A.id);

  const ok = await api("POST", `/api/shared/${shareToken}/run`, { body: {}, headers: { "x-share-password": "share-pw-zz-aud-1" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const run = await runStatus(ok.json.runId);
  assert.equal(run.actor_type, "share");
  assert.equal(run.started_by, null);

  assert.equal(await mentions(shareToken), 0, "a share token reached the audit trail");
  assert.equal(await mentions("guess-share-zz-aud-needle"), 0);
  assert.equal(await mentions("share-pw-zz-aud-1"), 0);

  await api("DELETE", `/api/notebooks/${MAIN}/shares/${shareId}`, { token: A.token });
  assert.equal((await one("share.revoke", "meta->>'shareId' = $1", [shareId])).user_id, A.id);
});

await check("a cron fire runs as its trigger, in a context of its own", async () => {
  let seen: unknown;
  const scheduler = new SchedulerService({
    listCron: async () => [
      { id: `zz-aud-cron-${RUN}`, notebook_id: MAIN, kind: "cron", cron: "* * * * *", slug: null, secret_key: null, enabled: true },
    ],
    startRun: async (id, publish, options) => {
      const { currentContext } = await import("../src/core/request-context.js");
      seen = currentContext()?.actor;
      return notebookExecutionService.start(id, publish, options);
    },
    hasRunInFlight: () => false,
  });
  const now = new Date("2026-03-10T10:00:00Z");
  scheduler.begin(() => {}, now);
  await scheduler.tick(new Date(now.getTime() + 60_000));
  assert.deepEqual(seen, { type: "cron", triggerId: `zz-aud-cron-${RUN}`, notebookId: MAIN });
  const run = await lastRun(MAIN);
  assert.equal(run.trigger_source, "cron");
  assert.equal(run.actor_type, "cron");
  assert.equal(run.trigger_id, `zz-aud-cron-${RUN}`);
  await runStatus(run.id);
});

console.log("\naccess, ownership, runs");

await check("granting, changing and revoking access record the role before and after", async () => {
  const grant = await api("PUT", `/api/notebooks/${MAIN}/access`, { token: A.token, body: { editors: [B.username] } });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  const added = await one("access.grant", "target_id = $1 AND meta->>'userId' = $2", [MAIN, B.id]);
  assert.equal(added.user_id, A.id);
  assert.equal(added.meta.roleBefore, null);
  assert.equal(added.meta.roleAfter, "editor");
  assert.equal(added.meta.username, B.username);

  await api("PUT", `/api/notebooks/${MAIN}/access`, { token: A.token, body: { editors: [], appUsers: [B.username], appVisibility: "selected" } });
  const changed = await one("access.change", "target_id = $1 AND meta->>'userId' = $2", [MAIN, B.id]);
  assert.equal(changed.meta.roleBefore, "editor");
  assert.equal(changed.meta.roleAfter, "app");
  const visibility = await one("access.change", "target_id = $1 AND meta ? 'appVisibility'", [MAIN]);
  assert.deepEqual(visibility.meta.appVisibility, { before: "all", after: "selected" });

  await api("PUT", `/api/notebooks/${MAIN}/access`, { token: A.token, body: { appUsers: [], appVisibility: "all" } });
  const revoked = await one("access.revoke", "target_id = $1 AND meta->>'userId' = $2", [MAIN, B.id]);
  assert.equal(revoked.meta.roleBefore, "app");
  assert.equal(revoked.meta.roleAfter, null);
});

await check("an editor asking to change access is told no, and it is recorded as denied", async () => {
  await api("PUT", `/api/notebooks/${MAIN}/access`, { token: A.token, body: { editors: [B.username] } });
  const reply = await api("PUT", `/api/notebooks/${MAIN}/access`, { token: B.token, body: { editors: [] } });
  assert.equal(reply.status, 403);
  const row = await one("access.change", "outcome = 'denied' AND user_id = $1", [B.id]);
  assert.equal(row.target_id, MAIN);
  assert.equal(row.target_owner_id, A.id);
  await api("PUT", `/api/notebooks/${MAIN}/access`, { token: A.token, body: { editors: [] } });
});

await check("cancelling a run is recorded against the person who cancelled it", async () => {
  const slow = await api("POST", "/api/notebooks", {
    token: A.token,
    body: { ...doc("zz-aud-slow"), steps: [{ id: "c1", kind: "cell", code: "await new Promise((r) => setTimeout(r, 15000)); return {};" }] },
  });
  const slowId = slow.json.id;
  notebooks.push(slowId);
  const started = await api("POST", `/api/notebooks/${slowId}/run`, { token: A.token, body: {} });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const cancelled = await api("POST", `/api/notebooks/${slowId}/runs/${started.json.runId}/cancel`, { token: A.token });
  assert.equal(cancelled.status, 202, JSON.stringify(cancelled.json));
  const row = await one("run.cancel", "target_id = $1", [slowId]);
  assert.equal(row.user_id, A.id);
  assert.equal(row.meta.runId, started.json.runId);
  await runStatus(started.json.runId);
});

await check("deleting a notebook is recorded with its name and owner, and the row outlives the notebook", async () => {
  const doomed = await api("POST", "/api/notebooks", { token: A.token, body: doc("zz-aud-doomed") });
  const id = doomed.json.id;
  const refused = await api("DELETE", `/api/notebooks/${id}`, { token: B.token });
  assert.equal(refused.status, 404);
  assert.equal((await api("DELETE", `/api/notebooks/${id}`, { token: A.token })).status, 200);
  const row = await one("notebook.delete", "target_id = $1", [id]);
  assert.equal(row.target_name, "zz-aud-doomed");
  assert.equal(row.target_owner_id, A.id);
  assert.equal(row.user_id, A.id);
  const { rows } = await pool.query("SELECT 1 FROM notebooks WHERE id = $1", [id]);
  assert.equal(rows.length, 0);
  // Its create event is still there, naming a notebook that no longer exists.
  assert.equal((await events("notebook.create", "target_id = $1", [id])).length, 1);
});

console.log("\ncommand line");

await check("a script's changes are the operator's: command, OS user, and the ids it changed", async () => {
  const me = os.userInfo().username;
  const user = await asOperator("zz-aud-cli", () => authService.createUser("zz-aud-cliuser", PASSWORD, "viewer"));
  const created = await one("user.create", "target_id = $1", [user.id]);
  assert.equal(created.actor_type, "cli");
  assert.equal(created.command, "zz-aud-cli");
  assert.equal(created.os_user, me);
  assert.equal(created.user_id, null);

  await asOperator("zz-aud-cli", () => authService.setRole(user.username, "creator"));
  const role = await one("user.role_change", "target_id = $1", [user.id]);
  assert.deepEqual({ before: role.meta.before, after: role.meta.after }, { before: "viewer", after: "creator" });
  assert.equal(role.actor_type, "cli");

  await asOperator("zz-aud-cli", () => authService.setPassword(user.username, "a-brand-new-password-zz-aud"));
  const reset = await one("auth.password_change", "target_id = $1 AND meta->>'via' = 'reset'", [user.id]);
  assert.equal(reset.actor_type, "cli");
  assert.equal(await mentions("a-brand-new-password-zz-aud"), 0);

  const issuedByCli = await asOperator("zz-aud-agent-token", () =>
    import("../src/services/agent-tokens.service.js").then(({ agentTokensService }) => agentTokensService.issue(user.id, "zz-aud-cli-token", "reader"))
  );
  assert.equal((await one("agent_token.issue", "target_id = $1", [issuedByCli.record.id])).command, "zz-aud-agent-token");
});

await check("transferring a notebook's owner is recorded with both accounts", async () => {
  const saved = await api("POST", "/api/notebooks", { token: A.token, body: doc("zz-aud-transfer") });
  notebooks.push(saved.json.id);
  await asOperator("transfer-owner", () => notebookAccessService.transferOwner(B.username, { username: A.username, notebookId: saved.json.id }));
  const row = await one("notebook.transfer_owner", "target_id = $1", [saved.json.id]);
  assert.equal(row.actor_type, "cli");
  assert.equal(row.target_owner_id, B.id);
  assert.equal(row.meta.fromUserId, A.id);
  assert.equal(row.meta.toUserId, B.id);
});

console.log("\nreading the trail (API)");

await check("it needs a session", async () => {
  assert.equal((await api("GET", "/api/audit")).status, 401);
  assert.equal((await api("GET", "/api/audit/export")).status, 401);
});

await check("a creator sees everything, newest first, in the agreed shape", async () => {
  const reply = await api("GET", "/api/audit?limit=5", { token: A.token });
  assert.equal(reply.status, 200);
  const { events: list, next } = reply.json;
  assert.equal(list.length, 5);
  assert.ok(next, "a trail this long has a next page");
  for (let i = 1; i < list.length; i += 1) assert.ok(BigInt(list[i - 1].id) > BigInt(list[i].id), "not newest first");
  const first = list[0];
  assert.deepEqual(Object.keys(first).sort(), ["action", "actor", "at", "id", "ip", "meta", "outcome", "requestId", "target", "userAgent"]);
  assert.ok(!Number.isNaN(Date.parse(first.at)) && first.at.endsWith("Z"));
  assert.equal(typeof first.actor.type, "string");
  assert.ok("type" in first.target && "id" in first.target && "ownerId" in first.target);
});

await check("the cursor pages without overlap or gaps", async () => {
  const one = (await api("GET", "/api/audit?limit=3", { token: A.token })).json;
  const two = (await api("GET", `/api/audit?limit=3&before=${one.next}`, { token: A.token })).json;
  const both = (await api("GET", "/api/audit?limit=6", { token: A.token })).json;
  assert.deepEqual([...one.events, ...two.events].map((e: any) => e.id), both.events.map((e: any) => e.id));
  assert.equal((await api("GET", "/api/audit?before=abc", { token: A.token })).status, 400);
});

await check("filters narrow by action prefix, actor type, target and outcome", async () => {
  const byPrefix = (await api("GET", "/api/audit?action=notebook.&limit=200", { token: A.token })).json.events;
  assert.ok(byPrefix.length > 0 && byPrefix.every((e: any) => e.action.startsWith("notebook.")));
  const byActor = (await api("GET", "/api/audit?actorType=agent&limit=200", { token: A.token })).json.events;
  assert.ok(byActor.length > 0 && byActor.every((e: any) => e.actor.type === "agent"));
  const byTarget = (await api("GET", `/api/audit?targetType=notebook&targetId=${MAIN}&limit=200`, { token: A.token })).json.events;
  assert.ok(byTarget.length > 0 && byTarget.every((e: any) => e.target.id === MAIN));
  const denied = (await api("GET", "/api/audit?outcome=denied&limit=200", { token: A.token })).json.events;
  assert.ok(denied.length > 0 && denied.every((e: any) => e.outcome === "denied"));
  assert.equal((await api("GET", "/api/audit?outcome=nope", { token: A.token })).status, 400);
  // `%` and `_` in a prefix are characters, not wildcards.
  assert.equal((await api("GET", "/api/audit?action=%25", { token: A.token })).json.events.length, 0);
});

await check("a non-creator sees what they did and what is theirs, and nothing of anyone else's", async () => {
  const mine = (await api("GET", "/api/audit?limit=200", { token: V.token })).json.events;
  assert.ok(mine.length > 0);
  for (const event of mine) {
    assert.ok(event.actor.user_id === V.id || event.target.ownerId === V.id, `leaked: ${event.action} ${JSON.stringify(event.actor)}`);
  }
  // Their own refused request is theirs; the creator's notebook is not.
  assert.ok(mine.some((e: any) => e.action === "authz.denied"));
  assert.ok(!mine.some((e: any) => e.target.id === MAIN));

  const none = (await api("GET", `/api/audit?targetId=${MAIN}&limit=200`, { token: V.token })).json.events;
  assert.equal(none.length, 0, "a stranger read a notebook's history");
});

await check("being the target of someone else's action makes the event yours", async () => {
  const invited = (await api("GET", "/api/audit?action=user.&limit=200", { token: A.token })).json.events.find((e: any) => e.action === "user.deactivate");
  assert.ok(invited);
  const person = await pool.query("SELECT id FROM users WHERE username = 'zz-aud-invited'");
  const login = await api("POST", "/api/auth/login", { body: { username: "zz-aud-invited", password: PASSWORD } });
  const theirs = (await api("GET", "/api/audit?action=user.&limit=200", { token: login.json.token })).json.events;
  assert.ok(theirs.some((e: any) => e.action === "user.deactivate" && e.target.ownerId === person.rows[0].id && e.actor.user_id === A.id));
});

await check("an owner who is not a creator any more still sees what happened to their things", async () => {
  // B was handed a notebook by the operator: it is theirs now, so its history is theirs to read.
  const owned = (await api("GET", "/api/audit?action=notebook.transfer_owner", { token: B.token })).json.events;
  assert.ok(owned.some((e: any) => e.target.ownerId === B.id));
  const other = (await api("GET", "/api/audit?action=notebook.transfer_owner", { token: W.token })).json.events;
  assert.equal(other.length, 0);
});

await check("the export is for creators, one JSON event per line, and follows the filters", async () => {
  const denied = await api("GET", "/api/audit/export?format=jsonl", { token: V.token });
  assert.equal(denied.status, 403);

  const response = await fetch(`${base}/api/audit/export?format=jsonl&action=notebook.deploy`, { headers: { authorization: `Bearer ${A.token}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /ndjson/);
  const lines = (await response.text()).split("\n").filter(Boolean);
  assert.ok(lines.length > 0);
  const parsed = lines.map((line) => JSON.parse(line));
  assert.ok(parsed.every((e) => e.action === "notebook.deploy"));
  assert.ok(parsed.every((e, i) => i === 0 || BigInt(parsed[i - 1].id) < BigInt(e.id)), "oldest first");
  assert.equal((await api("GET", "/api/audit/export?format=csv", { token: A.token })).status, 400);
});

await check("no verb changes or removes an event", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const reply = await api(method, "/api/audit", { token: A.token, body: {} });
    assert.ok([404, 405].includes(reply.status), `${method} /api/audit answered ${reply.status}`);
  }
  assert.ok([404, 405].includes((await api("DELETE", "/api/audit/1", { token: A.token })).status));
});

await check("the whole trail still verifies after all of this", async () => {
  const verdict = await audit.verifyChain();
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
});

console.log("\nrate limits");

await check("a rate-limited sign-in is recorded as denied", async () => {
  const before = process.env.LOGIN_RATE_LIMIT_MAX;
  process.env.LOGIN_RATE_LIMIT_MAX = "1";
  try {
    let reply = await api("POST", "/api/auth/login", { body: { username: "zz-aud-limited", password: "irrelevant-password-1" } });
    for (let i = 0; i < 3 && reply.status !== 429; i += 1) {
      reply = await api("POST", "/api/auth/login", { body: { username: "zz-aud-limited", password: "irrelevant-password-1" } });
    }
    assert.equal(reply.status, 429);
    assert.match(String(reply.json?.error), /Too many/);
    const row = await one("auth.login", "outcome = 'denied' AND meta->>'attempted' = 'zz-aud-limited'", []);
    assert.equal(row.meta.reason, "rate_limited");
  } finally {
    if (before === undefined) delete process.env.LOGIN_RATE_LIMIT_MAX;
    else process.env.LOGIN_RATE_LIMIT_MAX = before;
  }
});

for (const client of opened) await client.close().catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 300));
for (const id of notebooks) await notebooksService.delete(id).catch(() => {});
await secretsService
  .getAll(A.id)
  .then((all: { id: string }[]) => Promise.all(all.map((s) => secretsService.delete(A.id, s.id))))
  .catch(() => {});
await pool.query("DELETE FROM agent_tokens WHERE label LIKE 'zz-aud-%'");
await pool.query("DELETE FROM users WHERE username LIKE 'zz-aud-%'");
await dropOwner("audA");
await dropOwner("audB");
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

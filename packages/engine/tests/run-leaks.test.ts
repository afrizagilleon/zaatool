/**
 * L-01 .. L-06: what a run's secrets and cells' output can reach.
 *
 * One scenario per finding, each written to fail on the code before the fix:
 *
 *  - L-01  an invited editor's draft run must not be handed the owner's secrets
 *  - L-02  somebody who only uses an app reads its declared outputs, not its cells
 *  - L-03  a notebook of another owner that is called gets no logs or error text back
 *  - L-04  a share link follows only its own runs, and is sent only the ending
 *  - L-05  webhook callers and agents calling an app as a tool get a generic error
 *  - L-06  secret values are redacted from everything stored, and scrubbed on rotation
 *
 * Fixtures are `zz-leak-*` and removed at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/run-leaks.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/server/app.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { secretsService } from "../src/services/secrets.service.js";
import { authService } from "../src/services/auth.service.js";
import { agentTokensService } from "../src/services/agent-tokens.service.js";
import { notebookSharesService } from "../src/services/notebook-shares.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import {
  notebookExecutionService,
  secretHolderFor,
} from "../src/services/notebook-execution.service.js";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { WebSocketManager } from "../src/server/websocket-manager.js";
import { publicEvent, publicView, genericRunError } from "../src/core/run-projection.js";
import type { NotebookJson } from "@zaa-tool/shared";

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

const OWNER_SECRET = "sk-live-SUPERSECRET-123";
const EDITOR_SECRET = "editor-key-123456";
const b64 = (s: string): string => Buffer.from(s).toString("base64");
const hex = (s: string): string => Buffer.from(s).toString("hex");
/** Everything that must never reach a reader, in the forms a cell can print it. */
const FORMS = [OWNER_SECRET, b64(OWNER_SECRET), hex(OWNER_SECRET)];
const leaks = (text: string): string[] => FORMS.filter((form) => text.includes(form));
const noLeak = (text: string, where: string): void => {
  assert.deepEqual(leaks(text), [], `${where} carries the owner's secret:\n${text.slice(0, 600)}`);
};

await initDb();
const USERS = ["zz-leak-A", "zz-leak-E", "zz-leak-B", "zz-leak-V"];
const cleanUsers = async (): Promise<void> => {
  for (const u of USERS) await pool.query("DELETE FROM users WHERE username = $1", [u]);
};
await cleanUsers();
const A = await authService.createUser("zz-leak-A", "password-long-aaa1", "creator");
const E = await authService.createUser("zz-leak-E", "password-long-eee1", "creator");
const B = await authService.createUser("zz-leak-B", "password-long-bbb1", "creator");
const V = await authService.createUser("zz-leak-V", "password-long-vvv1", "viewer");
const tokenOf = async (u: string, p: string): Promise<string> => (await authService.login(u, p)).token;
const tA = await tokenOf("zz-leak-A", "password-long-aaa1");
const tE = await tokenOf("zz-leak-E", "password-long-eee1");
const tB = await tokenOf("zz-leak-B", "password-long-bbb1");
const tV = await tokenOf("zz-leak-V", "password-long-vvv1");

await secretsService.create(A.id, "API_KEY", OWNER_SECRET, true);

const hub = new RunEventHub();
const server = http.createServer(createApp((event) => hub.publish(event)));
const sockets = new WebSocketManager(server, hub);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const created: string[] = [];
async function make(doc: Partial<NotebookJson>, owner: string, deploy = true): Promise<string> {
  const { id } = await notebooksService.save(
    { version: "1.0", id: "", runtime: "node", ...doc } as NotebookJson,
    "test",
    owner
  );
  created.push(id);
  if (deploy) await notebooksService.deploy(id, "test");
  return id;
}

const api = (path: string, token: string, init: RequestInit = {}) =>
  fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });

async function settled(runId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const run = await notebookRunsService.getById(runId);
    if (run && run.status !== "running") return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`run ${runId} did not finish`);
}

/** Starts a run through the service and waits for the stored record to be whole. */
async function runAs(
  notebookId: string,
  options: Parameters<typeof notebookExecutionService.start>[2]
) {
  const started = await notebookExecutionService.start(notebookId, (e) => hub.publish(e), options);
  const result = await started.completed;
  return { runId: started.runId, result, row: (await notebookRunsService.getById(started.runId))! };
}

/** Everything a socket is sent for one run, until it ends or goes quiet. */
function follow(token: string, runId: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve) => {
    const events: Array<Record<string, unknown>> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let quiet: NodeJS.Timeout | undefined;
    const done = (): void => {
      clearTimeout(quiet);
      ws.close();
      resolve(events);
    };
    const hardStop = setTimeout(done, 9000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ action: "auth", token }));
      ws.send(JSON.stringify({ action: "subscribe", runId }));
    });
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString()) as Record<string, unknown>;
      events.push(event);
      if (event.type === "run:done" || event.type === "run:error" || event.type === "run:denied") {
        clearTimeout(hardStop);
        quiet = setTimeout(done, 400);
      }
    });
  });
}

// ── fixtures ────────────────────────────────────────────────────────────────

const HOOK_SLUG = "zz-leak-hook-slug-abcdefghijklmnopqrstuvwxyz";
const appId = await make(
  {
    name: "zz-leak-app",
    secrets: ["API_KEY"],
    outputs: ["ok"],
    inputs: [{ name: "mode", type: "string", default: "ok" }],
    triggers: [{ id: "t1", kind: "webhook", slug: HOOK_SLUG } as never],
    steps: [
      {
        id: "c1",
        kind: "cell",
        code:
          "console.log('calling api with', process.env.API_KEY);" +
          "console.log('b64', Buffer.from(process.env.API_KEY).toString('base64'));" +
          "console.log('hex', Buffer.from(process.env.API_KEY).toString('hex'));" +
          "return { hidden: process.env.API_KEY };",
      },
      {
        id: "c2",
        kind: "cell",
        code:
          "if (inputs.mode === 'fail') throw new Error('upstream 401 for key ' + process.env.API_KEY);" +
          "return { ok: true };",
      },
    ],
  },
  A.id
);

const calleeId = await make(
  {
    name: "zz-leak-callee",
    secrets: ["API_KEY"],
    outputs: ["r"],
    steps: [
      {
        id: "k1",
        kind: "cell",
        code: "console.log('CALLEE-LOG key=' + process.env.API_KEY); throw new Error('callee failed with ' + process.env.API_KEY);",
      },
    ],
  },
  A.id
);

const sameOwnerCallerId = await make(
  {
    name: "zz-leak-caller-a",
    steps: [
      {
        id: "x1",
        kind: "cell",
        code: "try { await notebooks.run('zz-leak-callee', {}); } catch (e) { console.log('caught:' + e.message); }",
      },
    ],
  },
  A.id,
  false
);

const otherOwnerCallerId = await make(
  {
    name: "zz-leak-caller-b",
    steps: [
      {
        id: "x1",
        kind: "cell",
        code: "try { await notebooks.run('zz-leak-callee', {}); } catch (e) { console.log('caught:' + e.message); }",
      },
    ],
  },
  B.id,
  false
);

// The editor's notebook: owned by A, E is invited. It reports *which* secret it received
// without printing it (a printed value would be redacted, hiding the very thing under test).
const sharedId = await make(
  {
    name: "zz-leak-shared",
    secrets: ["API_KEY"],
    outputs: ["tag"],
    steps: [
      {
        id: "s1",
        kind: "cell",
        code: "console.log(String(process.env.API_KEY)); return { tag: String(process.env.API_KEY ?? 'MISSING').split('-')[0] };",
      },
    ],
  },
  A.id
);
await pool.query(
  "INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1,$2,'editor'), ($3,$2,'editor')",
  [sharedId, E.id, appId]
);

// ── L-01 ────────────────────────────────────────────────────────────────────
console.log("\nL-01: whose secrets a run receives");

await check("the rule: owner and production use the owner's, an editor's draft uses the editor's", () => {
  assert.deepEqual(secretHolderFor("o", false, "o"), { holder: "o", substituted: false });
  assert.deepEqual(secretHolderFor("o", true, "e"), { holder: "o", substituted: false });
  assert.deepEqual(secretHolderFor("o", true, undefined), { holder: "o", substituted: false });
  assert.deepEqual(secretHolderFor("o", false, "e"), { holder: "e", substituted: true });
  assert.deepEqual(secretHolderFor("o", false, undefined), { holder: null, substituted: true });
  assert.deepEqual(secretHolderFor(null, false, "e"), { holder: null, substituted: false });
});

await check("an editor's draft run with no secret of their own sees it missing, and the log says so once", async () => {
  const { result, row } = await runAs(sharedId, { startedBy: E.id });
  assert.equal(result.status, "success", result.errors.join());
  assert.deepEqual(result.outputs, { tag: "MISSING" });
  const logs = row.cell_results.s1?.logs ?? [];
  const notes = logs.filter((l) => l.msg.includes("not among your own secrets"));
  assert.equal(notes.length, 1, JSON.stringify(logs));
  assert.ok(notes[0].msg.includes('"API_KEY"'));
  noLeak(JSON.stringify(row), "the editor's run record");
});

await check("PoC 4: the editor cannot decode the owner's secret out of a log any more", async () => {
  const id = await make(
    {
      name: "zz-leak-poc4",
      secrets: ["API_KEY"],
      steps: [{ id: "c1", kind: "cell", code: "console.log(Buffer.from(String(process.env.API_KEY)).toString('base64')); return {};" }],
    },
    A.id,
    false
  );
  await pool.query("INSERT INTO notebook_access (notebook_id, user_id, permission) VALUES ($1,$2,'editor')", [id, E.id]);
  const r = (await (await api(`/api/notebooks/${id}/run`, tE, { method: "POST", body: "{}" })).json()) as { runId: string };
  await settled(r.runId);
  const run = await (await api(`/api/notebooks/${id}/runs/${r.runId}`, tE)).text();
  noLeak(run, "the editor's own view of the run");
});

await check("an editor who has their own secret of that name gets theirs", async () => {
  await secretsService.create(E.id, "API_KEY", EDITOR_SECRET, true);
  const { result } = await runAs(sharedId, { startedBy: E.id });
  assert.deepEqual(result.outputs, { tag: "editor" });
});

await check("the owner's own draft run gets the owner's", async () => {
  const { result } = await runAs(sharedId, { startedBy: A.id });
  assert.deepEqual(result.outputs, { tag: "sk" });
});

await check("a production run of the deployed version (webhook) gets the owner's, whoever edited", async () => {
  const { result } = await runAs(sharedId, { triggerSource: "webhook" });
  assert.deepEqual(result.outputs, { tag: "sk" });
});

await check("a page run by the editor is production: the owner's", async () => {
  const { result } = await runAs(sharedId, { triggerSource: "page", startedBy: E.id });
  assert.deepEqual(result.outputs, { tag: "sk" });
});

// ── L-02 ────────────────────────────────────────────────────────────────────
console.log("\nL-02: somebody who only uses an app");

let viewerFailedRun = "";
let viewerOkRun = "";
await check("a viewer's run of an app: status, timings, declared outputs; no code, logs or middle values", async () => {
  const ok = (await (await api(`/api/notebooks/${appId}/run`, tV, { method: "POST", body: JSON.stringify({ args: { mode: "ok" } }) })).json()) as { runId: string };
  viewerOkRun = ok.runId;
  await settled(ok.runId);
  const text = await (await api(`/api/notebooks/${appId}/runs/${ok.runId}`, tV)).text();
  const run = JSON.parse(text);
  assert.equal(run.status, "success");
  assert.deepEqual(run.outputs, { ok: true });
  assert.deepEqual(run.cell_results, {});
  assert.ok(!text.includes("process.env"), "cell source in the response");
  assert.ok(!text.includes("calling api"), "log text in the response");
  assert.ok(!text.includes("hidden"), "an undeclared output in the response");
  noLeak(text, "the viewer's response");
});

await check("a viewer's failed run says only that it failed, with the run id", async () => {
  const bad = (await (await api(`/api/notebooks/${appId}/run`, tV, { method: "POST", body: JSON.stringify({ args: { mode: "fail" } }) })).json()) as { runId: string };
  viewerFailedRun = bad.runId;
  await settled(bad.runId);
  const text = await (await api(`/api/notebooks/${appId}/runs/${bad.runId}`, tV)).text();
  const run = JSON.parse(text);
  assert.equal(run.status, "failed");
  assert.equal(run.error, genericRunError(bad.runId));
  assert.ok(!text.includes("upstream"), "raw error text");
  assert.ok(!text.includes('"source"') && !text.includes("process.env"), "cell source");
  noLeak(text, "the viewer's failed run");
});

await check("the viewer's run listing and 'latest' are projected too", async () => {
  const list = await (await api(`/api/notebooks/${appId}/runs`, tV)).text();
  assert.ok(list.includes(viewerFailedRun));
  assert.ok(!list.includes("upstream"));
  const latest = await (await api(`/api/notebooks/${appId}/runs/latest`, tV)).text();
  assert.ok(!latest.includes("process.env") && !latest.includes("upstream"));
  noLeak(list + latest, "list/latest");
});

await check("the owner still reads the whole record, redacted", async () => {
  const text = await (await api(`/api/notebooks/${appId}/runs/${viewerFailedRun}`, tA)).text();
  const run = JSON.parse(text);
  assert.ok(run.cell_results.c1.source.includes("process.env.API_KEY"), "owner lost the source");
  assert.ok(run.error.includes("upstream 401 for key [secret:API_KEY]"), run.error);
  noLeak(text, "the owner's view");
});

await check("an agent token of the viewer's account gets the public view from run_inspect", async () => {
  const token = (await agentTokensService.issue(V.id, "zz-leak-v", "reader")).token;
  const client = new Client({ name: "zz-leak", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  );
  const reply = (await client.callTool({ name: "run_inspect", arguments: { run: viewerFailedRun } })) as { content: { text: string }[] };
  const text = reply.content[0].text;
  assert.ok(!text.includes("process.env") && !text.includes("upstream"), text.slice(0, 400));
  noLeak(text, "run_inspect for a viewer");
  await client.close();
});

// ── L-03 ────────────────────────────────────────────────────────────────────
console.log("\nL-03: a callee of another owner");

await check("the caller of another owner gets a generic error and none of the callee's logs", async () => {
  const { row } = await runAs(otherOwnerCallerId, { startedBy: B.id });
  const logs = (row.cell_results.x1?.logs ?? []).map((l) => l.msg).join("\n");
  assert.ok(logs.includes("caught:zz-leak-callee: run failed (run "), logs);
  assert.ok(!logs.includes("CALLEE-LOG"), "callee log forwarded");
  assert.ok(!logs.includes("callee failed with"), "callee error text forwarded");
  noLeak(JSON.stringify(row), "the caller's record");
});

await check("B cannot read the callee's source, logs or error through A's notebook", async () => {
  const { rows } = await pool.query("SELECT id FROM notebook_runs WHERE notebook_id = $1 AND started_by = $2", [calleeId, B.id]);
  assert.ok(rows.length > 0, "no callee run recorded for B");
  const one = await (await api(`/api/notebooks/${calleeId}/runs/${rows[0].id}`, tB)).text();
  const list = await (await api(`/api/notebooks/${calleeId}/runs`, tB)).text();
  for (const text of [one, list]) {
    assert.ok(!text.includes("process.env") && !text.includes("CALLEE-LOG") && !text.includes("callee failed with"), text.slice(0, 400));
    noLeak(text, "B's read of the callee run");
  }
});

await check("a caller of the SAME owner keeps the callee's error text, redacted", async () => {
  const { row } = await runAs(sameOwnerCallerId, { startedBy: A.id });
  const logs = (row.cell_results.x1?.logs ?? []).map((l) => l.msg).join("\n");
  assert.ok(logs.includes("callee failed with [secret:API_KEY]"), logs);
  assert.ok(logs.includes("[zz-leak-callee] CALLEE-LOG key=[secret:API_KEY]"), logs);
  noLeak(JSON.stringify(row), "the same-owner caller record");
});

// ── L-04 ────────────────────────────────────────────────────────────────────
console.log("\nL-04: a share link");

const link1 = await notebookSharesService.create(appId, "zz-leak-A");
const link2 = await notebookSharesService.create(appId, "zz-leak-A");
const shareRun = async (token: string, mode: string) =>
  ((await (await fetch(`${base}/api/shared/${token}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { mode } }),
  })).json()) as { runId: string }).runId;

await check("a share socket is sent the ending and the declared outputs only (success)", async () => {
  const runId = await shareRun(link1.token!, "ok");
  const events = await follow(link1.token!, runId);
  assert.deepEqual(events.map((e) => e.type), ["run:done"], JSON.stringify(events));
  assert.deepEqual(events[0].outputs, { ok: true });
  noLeak(JSON.stringify(events), "the share socket");
  assert.ok(!JSON.stringify(events).includes("hidden"));
});

await check("a share socket is sent a generic error on failure, no cell events", async () => {
  const runId = await shareRun(link1.token!, "fail");
  const events = await follow(link1.token!, runId);
  assert.deepEqual(events.map((e) => e.type), ["run:error"], JSON.stringify(events));
  assert.equal(events[0].error, genericRunError(runId));
  assert.equal(events[0].cellId, undefined);
  noLeak(JSON.stringify(events), "the share socket");
});

await check("a share socket cannot follow another run of the same notebook", async () => {
  const other = await shareRun(link2.token!, "ok");
  const events = await follow(link1.token!, other);
  assert.deepEqual(events.map((e) => e.type), ["run:denied"], JSON.stringify(events));
  const viewers = await follow(link1.token!, viewerOkRun);
  assert.deepEqual(viewers.map((e) => e.type), ["run:denied"]);
});

await check("a share socket opened after the run ended is told its ending the same way", async () => {
  const runId = await shareRun(link1.token!, "ok");
  await settled(runId);
  // Past the hub's retention the ending is rebuilt from the row; simulate by forgetting the channel.
  (hub as unknown as { channels: Map<string, unknown> }).channels.delete(runId);
  const events = await follow(link1.token!, runId);
  assert.deepEqual(events.map((e) => e.type), ["run:done"], JSON.stringify(events));
  assert.deepEqual(events[0].outputs, { ok: true });
});

await check("a viewer's session socket is projected like a share socket", async () => {
  const events = await follow(tV, viewerFailedRun);
  assert.deepEqual(events.map((e) => e.type), ["run:error"], JSON.stringify(events));
  noLeak(JSON.stringify(events), "the viewer's socket");
});

await check("the owner's socket still gets every event, redacted", async () => {
  const runId = await shareRun(link1.token!, "fail");
  await settled(runId);
  const events = await follow(tA, runId);
  const types = events.map((e) => e.type);
  assert.ok(types.includes("cell:log") && types.includes("cell:done") && types.includes("cell:error"), types.join());
  assert.ok(JSON.stringify(events).includes("[secret:API_KEY]"));
  noLeak(JSON.stringify(events), "the owner's socket");
});

await check("the watch channel carries status only", async () => {
  const seen: string[] = [];
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("open", () => {
      ws.send(JSON.stringify({ action: "auth", token: tA }));
      ws.send(JSON.stringify({ action: "watch" }));
      setTimeout(() => void runAs(appId, { args: { mode: "fail" }, triggerSource: "page", startedBy: A.id }), 300);
    });
    ws.on("message", (raw) => seen.push(raw.toString()));
    setTimeout(() => {
      ws.close();
      resolve();
    }, 4500);
  });
  assert.ok(seen.length > 0);
  for (const message of seen) {
    const event = JSON.parse(message);
    assert.ok(event.type === "run:activity" || event.type === "catalog:changed", message);
  }
  noLeak(seen.join(), "the watch channel");
});

// ── L-05 ────────────────────────────────────────────────────────────────────
console.log("\nL-05: webhook callers and agents calling an app");

await check("a failing webhook answers the generic error, not the cell's text", async () => {
  const res = await fetch(`${base}/hooks/${HOOK_SLUG}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "fail" }),
  });
  const text = await res.text();
  assert.equal(res.status, 500);
  const body = JSON.parse(text);
  assert.equal(body.status, "failed");
  assert.equal(body.error, genericRunError(body.runId));
  assert.ok(!text.includes("upstream"));
  noLeak(text, "the webhook response");
});

await check("a succeeding webhook answers the declared outputs only", async () => {
  const res = await fetch(`${base}/hooks/${HOOK_SLUG}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "ok" }),
  });
  const body = (await res.json()) as { status: string; outputs: unknown };
  assert.equal(res.status, 200);
  assert.deepEqual(body.outputs, { ok: true });
});

await check("an agent of another account calling the app as a tool gets a generic error", async () => {
  const token = (await agentTokensService.issue(B.id, "zz-leak-b", "reader")).token;
  const client = new Client({ name: "zz-leak", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  );
  const tool = (await client.listTools()).tools.map((t) => t.name).find((n) => n.includes("leak_app") || n.includes("leak-app"));
  assert.ok(tool, "the app is not offered as a tool");
  const reply = (await client.callTool({ name: tool!, arguments: { mode: "fail" } })) as { content: { text: string }[]; isError?: boolean };
  assert.equal(reply.isError, true);
  assert.ok(/failed \(run [0-9a-f-]{36}\)/.test(reply.content[0].text), reply.content[0].text);
  assert.ok(!reply.content[0].text.includes("upstream"));
  noLeak(reply.content[0].text, "the tool reply");
  await client.close();
});

// ── L-06 ────────────────────────────────────────────────────────────────────
console.log("\nL-06: redaction, scrub and retention");

await check("a secret printed in raw, base64 and hex is in none of what is stored", async () => {
  const { runId } = await runAs(appId, { args: { mode: "fail" }, triggerSource: "page", startedBy: V.id });
  const { rows } = await pool.query("SELECT cell_results::text AS c, error FROM notebook_runs WHERE id = $1", [runId]);
  noLeak(rows[0].c + rows[0].error, "the stored row");
  assert.ok(rows[0].c.includes("[secret:API_KEY]"));
});

await check("the completed outcome (what a webhook or a tool is built from) is redacted too", async () => {
  const { result } = await runAs(appId, { args: { mode: "fail" }, triggerSource: "webhook" });
  noLeak(JSON.stringify(result), "the outcome");
  assert.ok(result.errors[0].includes("[secret:API_KEY]"));
});

await check("a reader-scoped agent running a notebook is handed no secret", async () => {
  const token = (await agentTokensService.issue(A.id, "zz-leak-areader", "reader")).token;
  const client = new Client({ name: "zz-leak", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  );
  const reply = (await client.callTool({ name: "notebook_run", arguments: { notebook: "zz-leak-app", args: { mode: "ok" } } })) as { content: { text: string }[] };
  noLeak(reply.content[0].text, "notebook_run's reply");
  assert.ok(reply.content[0].text.includes("[secret:API_KEY]"));
  await client.close();
});

await check("changing a secret rewrites the old value out of stored runs", async () => {
  const { runId } = await runAs(appId, { args: { mode: "fail" }, triggerSource: "page", startedBy: A.id });
  // A run stored before redaction existed would hold the value as it is: plant one.
  await pool.query(
    "UPDATE notebook_runs SET cell_results = $2::jsonb, error = $3, outputs = $4::jsonb WHERE id = $1",
    [
      runId,
      JSON.stringify({ c1: { logs: [{ level: "info", msg: `old ${OWNER_SECRET} / ${b64(OWNER_SECRET)}` }], output: { x: OWNER_SECRET } } }),
      `failed with ${OWNER_SECRET}`,
      JSON.stringify({ ok: OWNER_SECRET }),
    ]
  );
  const row = (await secretsService.getAll(A.id)).find((s) => s.key === "API_KEY")!;
  await secretsService.update(A.id, row.id, "API_KEY", "sk-live-ROTATED-456", true);
  const after = await pool.query("SELECT cell_results::text AS c, error, outputs::text AS o FROM notebook_runs WHERE id = $1", [runId]);
  noLeak(after.rows[0].c + after.rows[0].error + after.rows[0].o, "the scrubbed row");
  assert.ok(after.rows[0].c.includes("[secret:API_KEY]"));
});

await check("deleting a secret scrubs its value too", async () => {
  const made = await secretsService.create(B.id, "ZZ_LEAK_DEL", "to-be-deleted-9876", true);
  const ran = await notebookRunsService.start({ runId: "zz-leak-run-del", notebookId: otherOwnerCallerId, triggerSource: "manual", startedBy: B.id });
  void ran;
  await notebookRunsService.recordCell("zz-leak-run-del", "x1", { logs: [{ level: "info", msg: "v=to-be-deleted-9876" }] });
  await secretsService.delete(B.id, made.id);
  const { rows } = await pool.query("SELECT cell_results::text AS c FROM notebook_runs WHERE id = 'zz-leak-run-del'");
  assert.ok(!rows[0].c.includes("to-be-deleted-9876"));
  assert.ok(rows[0].c.includes("[secret:ZZ_LEAK_DEL]"));
});

await check("retention: finished runs older than RUN_RETENTION_DAYS go, running ones stay", async () => {
  for (const id of ["zz-leak-old-done", "zz-leak-old-running", "zz-leak-new-done"]) {
    await notebookRunsService.start({ runId: id, notebookId: otherOwnerCallerId, triggerSource: "manual" });
  }
  await notebookRunsService.finish("zz-leak-old-done", "success");
  await notebookRunsService.finish("zz-leak-new-done", "success");
  await pool.query("UPDATE notebook_runs SET started_at = NOW() - INTERVAL '120 days', finished_at = NOW() - INTERVAL '119 days' WHERE id = 'zz-leak-old-done'");
  await pool.query("UPDATE notebook_runs SET started_at = NOW() - INTERVAL '120 days' WHERE id = 'zz-leak-old-running'");
  await notebookRunsService.pruneExpired();
  const { rows } = await pool.query("SELECT id FROM notebook_runs WHERE id LIKE 'zz-leak-%' ORDER BY id");
  const ids = rows.map((r) => r.id);
  assert.ok(!ids.includes("zz-leak-old-done"), "an old finished run survived");
  assert.ok(ids.includes("zz-leak-old-running"), "a running run was deleted");
  assert.ok(ids.includes("zz-leak-new-done"), "a recent run was deleted");
});

// ── projection shapes ───────────────────────────────────────────────────────
console.log("\npublic projection shapes");

await check("publicView: id, status, timings, declared outputs only", () => {
  const view = publicView(
    {
      id: "r1", notebook_id: "n1", status: "success", trigger_source: "page",
      started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:01Z",
      outputs: { shown: 1, undeclared: 2 },
    },
    { outputs: ["shown"] }
  );
  assert.deepEqual(view.outputs, { shown: 1 });
  assert.deepEqual(view.cell_results, {});
  assert.equal(view.error, null);
  assert.equal(view.parent_run_id, null);
  assert.equal(view.started_by, null);
});

await check("publicView: no contract means no outputs; failed means generic error and no outputs", () => {
  const base = { id: "r1", notebook_id: "n1", trigger_source: "page" as const, started_at: "a", finished_at: "b" };
  assert.deepEqual(publicView({ ...base, status: "success", outputs: { a: 1 } }, null).outputs, {});
  const failed = publicView({ ...base, status: "failed", outputs: { a: 1 } }, { outputs: ["a"] });
  assert.equal(failed.error, "Run failed (run r1)");
  assert.equal(failed.outputs, null);
});

await check("publicEvent: only the ending survives", () => {
  const ev = (type: string, extra: object = {}) => ({ type, runId: "r1", notebookId: "n1", ...extra }) as never;
  assert.equal(publicEvent(ev("cell:start", { cellId: "c" })), null);
  assert.equal(publicEvent(ev("cell:log", { payload: "x" })), null);
  assert.equal(publicEvent(ev("cell:done", { output: { a: 1 } })), null);
  assert.equal(publicEvent(ev("cell:error", { error: "boom" })), null);
  assert.deepEqual(publicEvent(ev("run:error", { error: "boom", cellId: "c" })), {
    type: "run:error", runId: "r1", notebookId: "n1", error: "Run failed (run r1)", ms: 0,
  });
  assert.deepEqual(publicEvent(ev("run:done", { outputs: { a: 1 }, ms: 5 })), {
    type: "run:done", runId: "r1", notebookId: "n1", status: "success", ms: 5, outputs: { a: 1 },
  });
});

// ── cleanup ─────────────────────────────────────────────────────────────────
for (const id of created) await notebooksService.delete(id).catch(() => {});
await pool.query("DELETE FROM notebook_runs WHERE id LIKE 'zz-leak-%'");
await pool.query("DELETE FROM secrets WHERE owner_id IN ($1,$2,$3)", [A.id, E.id, B.id]);
await pool.query("DELETE FROM agent_tokens WHERE label LIKE 'zz-leak-%'");
await cleanUsers();
sockets.close();
server.close();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

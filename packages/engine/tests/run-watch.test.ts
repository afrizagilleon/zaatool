/**
 * M7.4 — watching the workspace without being able to read it.
 *
 * The map needs to know that *something* is running without holding a run id. It is no
 * longer reachable by anyone who can open the socket — a socket says who it is first — but
 * the reason the channel is thin has not changed: it is not scoped to a run the client
 * proved it started. So the thing worth testing is still that outputs and logs never
 * travel on it, and now also that a socket which never identified itself gets nothing.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/run-watch.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { WebSocketManager } from "../src/server/websocket-manager.js";
import { notifyCatalogChanged } from "../src/core/catalog-events.js";
import { jwtSecret } from "../src/config.js";
import jwt from "jsonwebtoken";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";
import type { RunEvent } from "@zaa-tool/shared";

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

/**
 * Since FX-17 a socket only hears about runs and notebooks its account could see over REST,
 * so the account has to exist and the runs and notebooks it is told about have to be real
 * rows: `nb1` and `nb9` belong to it, and `r1`..`r8` are runs of `nb1` that nobody
 * started, which is the team's to read.
 */
await initDb();
await pool.query("DELETE FROM notebook_runs WHERE id ~ '^r[0-9]$'");
await pool.query("DELETE FROM notebooks WHERE id IN ('nb1', 'nb9')");
await pool.query("DELETE FROM users WHERE username = 'zz-watch'");
const watcherAccount = await authService.createUser("zz-watch", "zz-watch-password-long", "creator");
for (const id of ["nb1", "nb9"]) {
  await pool.query(
    "INSERT INTO notebooks (id, name, runtime, document, owner_id) VALUES ($1, $2, 'node', '{}', $3)",
    [id, `zz-watch-${id}`, watcherAccount.id]
  );
}
for (let n = 1; n <= 8; n += 1) {
  await pool.query(
    "INSERT INTO notebook_runs (id, notebook_id, status, trigger_source) VALUES ($1, 'nb1', 'running', 'cron')",
    [`r${n}`]
  );
}

const server = http.createServer();
const hub = new RunEventHub();
const manager = new WebSocketManager(server, hub);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
// `/ws` rather than the root: the root is the single-page app once this is deployed,
// and a socket mounted there was answered with `index.html`.
const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;

/** A real session, signed the way a sign-in signs one. */
const session = jwt.sign({ id: watcherAccount.id, username: "zz-watch", role: "creator" }, jwtSecret(), {
  expiresIn: "5m",
});

/** Opens a socket and identifies it, which every client must now do before asking. */
async function open(): Promise<{ socket: WebSocket; messages: Record<string, unknown>[] }> {
  const socket = new WebSocket(url);
  const messages: Record<string, unknown>[] = [];
  await new Promise<void>((resolve) => socket.on("open", () => resolve()));
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  socket.send(JSON.stringify({ action: "auth", token: session }));
  return { socket, messages };
}

/** Opens a watching socket and collects whatever it is sent. */
async function watch(): Promise<{ messages: Record<string, unknown>[]; close: () => void }> {
  const { socket, messages } = await open();
  socket.send(JSON.stringify({ action: "watch" }));

  // The subscription is registered on the server's next tick; give it one.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { messages, close: () => socket.close() };
}

const event = (over: Partial<RunEvent>): RunEvent =>
  ({ type: "cell:start", runId: "r1", notebookId: "nb1", ...over }) as RunEvent;

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

console.log("\nwhat a watcher is told");

await check("a run in progress is announced as running", async () => {
  const watcher = await watch();
  hub.publish(event({ type: "cell:start", cellId: "c1" }));
  await settle();

  assert.deepEqual(watcher.messages, [
    { type: "run:activity", runId: "r1", notebookId: "nb1", status: "running" },
  ]);
  watcher.close();
});

await check("finishing and failing are distinguishable", async () => {
  const watcher = await watch();
  hub.publish(event({ type: "run:done", runId: "r2" }));
  hub.publish(event({ type: "run:error", runId: "r3", error: "kaboom" }));
  await settle();

  assert.deepEqual(
    watcher.messages.map((message) => message.status),
    ["success", "failed"]
  );
  watcher.close();
});

console.log("\nwhat a watcher is never told");

await check("a cell's output never reaches the watch channel", async () => {
  const watcher = await watch();
  hub.publish(event({ type: "cell:done", cellId: "c1", output: { apiKey: "leaked" }, written: ["apiKey"] }));
  hub.publish(event({ type: "cell:log", cellId: "c1", payload: "secret log line" }));
  await settle();

  assert.deepEqual(watcher.messages, [], `watcher received ${JSON.stringify(watcher.messages)}`);
  watcher.close();
});

await check("even the announced events carry nothing but identity and status", async () => {
  const watcher = await watch();
  hub.publish(event({ type: "run:error", runId: "r4", error: "database password is wrong" }));
  await settle();

  assert.deepEqual(Object.keys(watcher.messages[0]).sort(), ["notebookId", "runId", "status", "type"]);
  watcher.close();
});

console.log("\nthe old channel still behaves");

await check("subscribing to one run still delivers that run in full", async () => {
  const { socket, messages } = await open();
  socket.send(JSON.stringify({ action: "subscribe", runId: "r5" }));
  await settle();
  hub.publish(event({ type: "cell:done", runId: "r5", cellId: "c1", output: { value: 42 } }));
  await settle();

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].output, { value: 42 }, "a subscriber must still see its own output");
  socket.close();
});

await check("a watcher does not receive another run's detail either", async () => {
  const watcher = await watch();
  const { socket: subscriber } = await open();
  subscriber.send(JSON.stringify({ action: "subscribe", runId: "r6" }));
  await settle();

  hub.publish(event({ type: "cell:done", runId: "r6", cellId: "c1", output: { value: 7 } }));
  await settle();

  assert.deepEqual(watcher.messages, [], "the watcher saw a subscriber's output");
  watcher.close();
  subscriber.close();
});

console.log("\nwhat a watcher is told about the notebooks themselves");

await check("a saved notebook reaches a watcher without it asking again", async () => {
  const watcher = await watch();
  notifyCatalogChanged({ change: "saved", notebookId: "nb9" });
  await settle();

  assert.deepEqual(watcher.messages, [
    { type: "catalog:changed", change: "saved", notebookId: "nb9" },
  ]);
  watcher.close();
});

await check("deploying and deleting are distinguishable", async () => {
  const watcher = await watch();
  notifyCatalogChanged({ change: "deployed", notebookId: "nb9" });
  notifyCatalogChanged({ change: "deleted", notebookId: "nb9" });
  await settle();

  assert.deepEqual(
    watcher.messages.map((message) => message.change),
    ["deployed", "deleted"]
  );
  watcher.close();
});

await check("it carries identity only, never the notebook", async () => {
  // Same rule as run activity, for the same reason: this channel is not scoped to
  // anything the client proved it may see. It says *that* something moved; what moved
  // is fetched over HTTP, where the ordinary permissions apply.
  const watcher = await watch();
  notifyCatalogChanged({ change: "saved", notebookId: "nb9" });
  await settle();

  assert.deepEqual(Object.keys(watcher.messages[0]).sort(), ["change", "notebookId", "type"]);
  watcher.close();
});

await check("a socket that only subscribed to one run is not told", async () => {
  const { socket, messages } = await open();
  socket.send(JSON.stringify({ action: "subscribe", runId: "r8" }));
  await settle();
  notifyCatalogChanged({ change: "saved", notebookId: "nb9" });
  await settle();

  assert.deepEqual(messages, [], `a subscriber received ${JSON.stringify(messages)}`);
  socket.close();
});

await check("a watcher that closed is not still listening", async () => {
  // The listener lives in the same map as the run subscription, so it is released by the
  // same close handler. Left behind, every reconnect over a long session would add one
  // more copy of the same send to a socket nobody is holding.
  const watcher = await watch();
  watcher.close();
  await settle();

  notifyCatalogChanged({ change: "saved", notebookId: "nb9" });
  await settle();
  assert.deepEqual(watcher.messages, []);
});

console.log("\na socket that never said who it is");

await check("asking before identifying is refused, and delivers nothing", async () => {
  const socket = new WebSocket(url);
  const messages: Record<string, unknown>[] = [];
  await new Promise<void>((resolve) => socket.on("open", () => resolve()));
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));

  socket.send(JSON.stringify({ action: "subscribe", runId: "r7" }));
  await settle();
  hub.publish(event({ type: "cell:done", runId: "r7", cellId: "c1", output: { value: 99 } }));
  await settle();

  assert.equal(messages.length, 1, "expected the refusal and nothing else");
  assert.equal(messages[0].type, "run:denied");
  socket.close();
});

await check("a token that is nobody's closes the socket", async () => {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve) => socket.on("open", () => resolve()));

  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  socket.send(JSON.stringify({ action: "auth", token: "not-a-token" }));

  await Promise.race([closed, new Promise((_, reject) => setTimeout(reject, 2000))]);
});

manager.close();
server.close();
await pool.query("DELETE FROM notebook_runs WHERE id ~ '^r[0-9]$'");
await pool.query("DELETE FROM notebooks WHERE id IN ('nb1', 'nb9')");
await pool.query("DELETE FROM users WHERE username = 'zz-watch'");
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

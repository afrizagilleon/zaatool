/**
 * M7.4 — watching the workspace without being able to read it.
 *
 * The map needs to know that *something* is running without holding a run id, which
 * means this channel is reachable by anyone who can open the socket. So the thing worth
 * testing is not that events arrive — it is that outputs and logs never do.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/run-watch.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { WebSocketManager } from "../src/server/websocket-manager.js";
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

const server = http.createServer();
const hub = new RunEventHub();
const manager = new WebSocketManager(server, hub);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;

/** Opens a watching socket and collects whatever it is sent. */
async function watch(): Promise<{ messages: Record<string, unknown>[]; close: () => void }> {
  const socket = new WebSocket(url);
  const messages: Record<string, unknown>[] = [];

  await new Promise<void>((resolve) => socket.on("open", () => resolve()));
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  socket.send(JSON.stringify({ action: "watch" }));

  // The subscription is registered on the server's next tick; give it one.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { messages, close: () => socket.close() };
}

const event = (over: Partial<RunEvent>): RunEvent =>
  ({ type: "cell:start", runId: "r1", flowId: "nb1", ...over }) as RunEvent;

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

console.log("\nwhat a watcher is told");

await check("a run in progress is announced as running", async () => {
  const watcher = await watch();
  hub.publish(event({ type: "cell:start", cellId: "c1" }));
  await settle();

  assert.deepEqual(watcher.messages, [
    { type: "run:activity", runId: "r1", flowId: "nb1", status: "running" },
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

  assert.deepEqual(Object.keys(watcher.messages[0]).sort(), ["flowId", "runId", "status", "type"]);
  watcher.close();
});

console.log("\nthe old channel still behaves");

await check("subscribing to one run still delivers that run in full", async () => {
  const socket = new WebSocket(url);
  const messages: Record<string, unknown>[] = [];
  await new Promise<void>((resolve) => socket.on("open", () => resolve()));
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));

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
  const subscriber = new WebSocket(url);
  await new Promise<void>((resolve) => subscriber.on("open", () => resolve()));
  subscriber.send(JSON.stringify({ action: "subscribe", runId: "r6" }));
  await settle();

  hub.publish(event({ type: "cell:done", runId: "r6", cellId: "c1", output: { value: 7 } }));
  await settle();

  assert.deepEqual(watcher.messages, [], "the watcher saw a subscriber's output");
  watcher.close();
  subscriber.close();
});

manager.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

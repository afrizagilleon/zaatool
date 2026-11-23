/**
 * C-10 — a WebSocket ends when the session behind it does.
 *
 * A session was checked once, when the socket connected, and never again: after
 * `logout-all`, a password change or deactivating the account, the socket kept streaming.
 * Each case opens a live socket, proves it is receiving, ends the session, and asserts the
 * socket is closed and nothing more reached it.
 *
 * Everything it makes is prefixed `zz-w2ws-` and removed at the start and the end.
 *
 *   pnpm --filter @zaa-tool/engine test w2-socket-session
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import WebSocket from "ws";
import { createApp } from "../src/server/app.js";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { WebSocketManager } from "../src/server/websocket-manager.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { authService } from "../src/services/auth.service.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notifyCatalogChanged } from "../src/core/catalog-events.js";
import { jwtSecret } from "../src/config.js";

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
process.env.LOGIN_RATE_LIMIT_MAX = "1000";

const server = http.createServer(createApp(() => {}));
const sockets = new WebSocketManager(server, new RunEventHub());
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;

const PASSWORD = "zz-w2ws-password-long";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function clean(): Promise<void> {
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-w2ws-%'");
  for (const row of rows) await notebooksService.delete(row.id).catch(() => undefined);
  await pool.query("DELETE FROM users WHERE username LIKE 'zz-w2ws-%'");
}
await clean();

async function account(label: string) {
  const created = await authService.createUser(`zz-w2ws-${label}`, PASSWORD, "creator");
  const token = (await authService.login(`zz-w2ws-${label}`, PASSWORD)).token;
  const notebook = (
    await notebooksService.save(
      { version: "1.0", id: "", name: `zz-w2ws-nb-${label}`, runtime: "node", steps: [{ id: "c1", kind: "cell", code: "return {};" }] },
      "test",
      created.id
    )
  ).id;
  return { id: created.id, token, notebook };
}

/** A socket that has proven it is live: it was told about a change to its owner's notebook. */
async function liveSocket(who: { token: string; notebook: string }, token = who.token) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const heard: string[] = [];
  let closed = false;
  socket.on("message", (raw) => heard.push(JSON.parse(raw.toString()).type));
  socket.on("close", () => (closed = true));
  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
  socket.send(JSON.stringify({ action: "auth", token }));
  socket.send(JSON.stringify({ action: "watch" }));
  await sleep(300);
  notifyCatalogChanged({ change: "saved", notebookId: who.notebook });
  await sleep(300);
  assert.ok(heard.includes("catalog:changed"), `the socket was not live to begin with: ${JSON.stringify(heard)}`);
  return { socket, heard, isClosed: () => closed };
}

async function assertEnded(live: Awaited<ReturnType<typeof liveSocket>>, who: { notebook: string }) {
  await sleep(600);
  assert.equal(live.isClosed(), true, "the socket is still open");
  const before = live.heard.length;
  notifyCatalogChanged({ change: "saved", notebookId: who.notebook });
  await sleep(300);
  assert.equal(live.heard.length, before, "an event reached a socket whose session had ended");
}

console.log("\nthe session ends, the socket ends");

await check("logout-all closes the account's sockets and nothing reaches them afterwards", async () => {
  const me = await account("all");
  const live = await liveSocket(me);
  await authService.revokeSessions(me.id);
  await assertEnded(live, me);
});

await check("deactivating the account closes its sockets", async () => {
  const me = await account("off");
  const live = await liveSocket(me);
  await authService.setActive(me.id, false);
  await assertEnded(live, me);
});

await check("changing the password closes the sockets of the old sessions", async () => {
  const me = await account("pw");
  const live = await liveSocket(me);
  await authService.changePassword(me.id, PASSWORD, `${PASSWORD}-changed`);
  await assertEnded(live, me);
});

await check("a token that expires closes its socket at that moment", async () => {
  const me = await account("exp");
  const current = (await authService.currentUser(me.id))!;
  const short = jwt.sign({ id: me.id, username: current.username, role: current.role, tv: current.tokenVersion }, jwtSecret(), {
    expiresIn: 2,
  });
  const live = await liveSocket(me, short);
  await sleep(2200);
  assert.equal(live.isClosed(), true, "the socket outlived its token");
});

await check("ending one account's sessions leaves another account's socket alone", async () => {
  const one = await account("one");
  const two = await account("two");
  const liveOne = await liveSocket(one);
  const liveTwo = await liveSocket(two);
  await authService.revokeSessions(one.id);
  await sleep(600);
  assert.equal(liveOne.isClosed(), true);
  assert.equal(liveTwo.isClosed(), false, "somebody else's socket was closed");
  const before = liveTwo.heard.length;
  notifyCatalogChanged({ change: "saved", notebookId: two.notebook });
  await sleep(300);
  assert.equal(liveTwo.heard.length, before + 1, "the other account stopped hearing");
  liveTwo.socket.close();
});

sockets.close();
server.close();
await clean();
await pool.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

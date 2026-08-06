/**
 * Reachable from a device that is not this laptop.
 *
 * The report was two sentences: *"tidak bisa membuka di ponsel. saya tidak bisa login
 * dengan `pnpm run dev --host` dengan ip yang ada. `failed to fetch` bacaannya ketika
 * login."* Everything in this file is one of the reasons that happened, turned into a
 * check that fails if it comes back.
 *
 * The largest one is not a bug in any single file. Development had two origins and
 * production had one, so the bundle carried an address for development that could only
 * ever be right on the machine that built it. `localhost` on a phone is the phone. Making
 * development match production — one origin, everything proxied — is what fixes it, and
 * that only holds while the two proxy lists agree. So the last section here reads
 * `nginx.conf` and `vite.config.ts` and requires them to say the same thing.
 *
 *   pnpm --filter @zaa-tool/engine test reachable
 */
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { RunEventHub } from "../src/server/run-event-hub.js";
import { WebSocketManager } from "../src/server/websocket-manager.js";
import { corsPolicy } from "../src/server/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

let passed = 0;
let failed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
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

// ── the run stream has a path ─────────────────────────────────────────────────

console.log("\nthe run stream lives somewhere nginx can find it");

const server = http.createServer((_req, res) => {
  // Standing in for the single-page app: whatever nginx would serve at `/`.
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<!doctype html><title>app</title>");
});
new WebSocketManager(server, new RunEventHub());
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;

/** Whether a socket opens at this path, without caring what it then says. */
function opens(pathname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${pathname}`);
    const settle = (answer: boolean) => {
      socket.removeAllListeners();
      socket.close();
      resolve(answer);
    };
    socket.on("open", () => settle(true));
    socket.on("error", () => settle(false));
  });
}

await check("the stream opens at /ws", async () => {
  assert.equal(await opens("/ws"), true, "nothing accepted a socket at /ws");
});

await check("and not at the root, which belongs to the app", async () => {
  // The regression this replaces: mounted at the root, the upgrade request matched
  // nginx's `location /` and was answered with `index.html`. Live run events could not
  // work in any deployed build, and nothing said so — the socket simply never opened.
  assert.equal(await opens("/"), false, "the root still accepts sockets");
});

await new Promise<void>((resolve) => server.close(() => resolve()));

// ── who may call this engine from a browser ───────────────────────────────────

console.log("\nthe door is only as wide as it has to be");

/** Runs `run` with the environment temporarily set, then puts it back. */
function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const before: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

await check("a declared list is the list, in every environment", () => {
  withEnv({ CORS_ORIGINS: "https://app.example.com, https://staging.example.com" }, () => {
    assert.deepEqual(corsPolicy().origin, ["https://app.example.com", "https://staging.example.com"]);
  });
});

await check("production with nothing declared allows same-origin only", () => {
  // Which is what a correct deployment already is: nginx serves the bundle and the engine
  // from one host, so a browser never sends `Origin` at all.
  withEnv({ CORS_ORIGINS: undefined, NODE_ENV: "production" }, () => {
    assert.equal(corsPolicy().origin, false);
  });
});

await check("development stays permissive, because a phone's address is unpredictable", () => {
  withEnv({ CORS_ORIGINS: undefined, NODE_ENV: "development" }, () => {
    assert.equal(corsPolicy().origin, true);
  });
});

await check("it is no longer the bare `cors()` that reflected any origin in production", () => {
  withEnv({ CORS_ORIGINS: undefined, NODE_ENV: "production" }, () => {
    assert.notEqual(corsPolicy().origin, true, "production still reflects whatever asks");
  });
});

// ── development and production proxy the same paths ───────────────────────────

console.log("\ndev and production route the same way");

const nginx = readFileSync(path.join(repo, "packages/web/nginx.conf"), "utf8");
const viteConfig = readFileSync(path.join(repo, "packages/web/vite.config.ts"), "utf8");

/** Paths nginx hands to the engine, from its `location … proxy_pass` lines. */
function nginxProxied(): string[] {
  return [...nginx.matchAll(/location\s+(\S+)\s*\{\s*proxy_pass/g)]
    .map((match) => `/${match[1].replace(/^\/|\/$/g, "")}`)
    .sort();
}

/** Paths the dev server hands to the engine, from the `proxy` block. */
function viteProxied(): string[] {
  const block = viteConfig.slice(viteConfig.indexOf("proxy: {"));
  return [...block.matchAll(/"(\/[a-z]+)":/g)].map((match) => match[1]).sort();
}

await check("every path nginx proxies, the dev server proxies too", () => {
  // The failure this prevents is the quiet kind: a route that works while building and
  // 404s once deployed, or the reverse, discovered by someone else on a phone.
  assert.deepEqual(viteProxied(), nginxProxied());
});

await check("the run stream is one of them, on both sides", () => {
  assert.ok(nginxProxied().includes("/ws"), "nginx has no location for /ws");
  assert.ok(viteProxied().includes("/ws"), "the dev server does not proxy /ws");
});

await check("the dev server binds every interface, or a phone reaches nothing", () => {
  assert.match(viteConfig, /host:\s*true/, "vite.config.ts has no server.host");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

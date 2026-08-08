/**
 * M7.1 — the map, over the wire the browser uses.
 *
 * The builder has its own unit suite; this checks the route: that `/map` is not read as
 * a notebook id, that the guard applies, and that a notebook saved through the service
 * shows up on the map the browser fetches.
 *
 * Notebooks it creates are prefixed `zz-map-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-map-api.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { authService } from "../src/services/auth.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { jwtSecret } from "../src/config.js";
import type { NotebookJson, NotebookMap } from "@zaa-tool/shared";


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

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

await pool.query("DELETE FROM users WHERE username LIKE 'zz-map-%'");
const testUser = await authService.createUser("zz-map-tester", "password123456", "creator");


const token = jwt.sign(
  { id: testUser.id, username: testUser.username, role: "creator" },
  jwtSecret(),
  { expiresIn: "5m" }
);


const created: string[] = [];

async function store(document: Omit<NotebookJson, "version">): Promise<string> {
  const { id } = await notebooksService.save({ version: "1.0", ...document });
  created.push(id);
  return id;
}

const fetchMap = async (): Promise<NotebookMap> => {
  const res = await fetch(`${base}/api/notebooks/map`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200, `map returned ${res.status}`);
  return (await res.json()) as NotebookMap;
};

console.log("\nthe route");

await check("the map needs a session, like everything else under /api", async () => {
  const res = await fetch(`${base}/api/notebooks/map`);
  assert.equal(res.status, 401);
});

await check("`map` is a route, not a notebook whose id happens to be 'map'", async () => {
  const map = await fetchMap();
  assert.ok(Array.isArray(map.notebooks), "expected a map, got something else");
});

console.log("\nwhat the browser sees");

await check("a saved notebook and its trigger appear on the map", async () => {
  const id = await store({
    id: "",
    name: "zz-map-source",
    runtime: "node",
    outputs: ["rate"],
    triggers: [{ id: "zz-map-t1", kind: "cron", cron: "0 6 * * *" }],
    steps: [{ id: "zz-map-c1", kind: "cell", code: "return { rate: 1 };" }],
  });

  const map = await fetchMap();
  const notebook = map.notebooks.find((entry) => entry.id === id);
  assert.ok(notebook, "the notebook is missing from the map");
  assert.deepEqual(notebook.outputs, ["rate"]);
  assert.ok(
    map.triggers.some((trigger) => trigger.notebookId === id && trigger.label === "0 6 * * *"),
    "the cron is missing from the map"
  );
});

await check("a call written in a cell becomes an edge on the map", async () => {
  const target = created[0];
  const callerId = await store({
    id: "",
    name: "zz-map-caller",
    runtime: "node",
    steps: [
      {
        id: "zz-map-c2",
        kind: "cell",
        code: "const r = await notebooks.run('zz-map-source'); return { r };",
      },
    ],
  });

  const map = await fetchMap();
  const call = map.calls.find((entry) => entry.fromNotebookId === callerId);
  assert.ok(call, "the call is missing from the map");
  assert.equal(call.toNotebookId, target);
  assert.equal(call.resolved, true);
});

await check("deleting a notebook removes it from the map, with no cleanup step", async () => {
  const id = await store({
    id: "",
    name: "zz-map-temporary",
    runtime: "node",
    steps: [{ id: "zz-map-c3", kind: "cell", code: "return {};" }],
  });

  await notebooksService.delete(id);
  const map = await fetchMap();
  assert.ok(!map.notebooks.some((entry) => entry.id === id), "a deleted notebook is still mapped");
});

for (const id of created) await notebooksService.delete(id).catch(() => {});
await pool.query("DELETE FROM users WHERE username LIKE 'zz-map-%'");
await pool.end();
server.close();


console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

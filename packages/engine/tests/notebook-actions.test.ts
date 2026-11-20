/**
 * M17 — buttons on a page, and the form one of them asks for.
 *
 * Two claims are under test, and both are about restraint rather than capability.
 *
 * The first: a page can only reach what its own buttons already point at. The browser
 * names an action by *position*, never by target, so `/actions/:index` is not a way to
 * run anything you can name.
 *
 * The second: what a `run` button asks for is **derived** from the notebook it calls.
 * Nothing about that form is declared anywhere, which is what stops a page from growing
 * a form builder — and what makes it wrong to add an input to a page just to feed a
 * button, since the field belongs to whichever notebook reads it.
 *
 * Notebooks it creates are prefixed `zz-act-` and left behind; they are cheap and make a
 * failure reproducible by hand.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-actions.test.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { actionSpecs, actionProblems } from "../src/core/notebook-actions.js";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { authService } from "../src/services/auth.service.js";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import type { NotebookAction, NotebookPage } from "@zaa-tool/shared";

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

await initDb();

const server = http.createServer(createApp(() => {}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// The pages endpoint is behind the session guard, so the test needs one. Made directly
// rather than through `register`, which is now closed once an installation has anybody in
// it — that refusal is `access.test.ts`'s business, not this file's.
await pool.query("DELETE FROM users WHERE username = 'zz-act-user'").catch(() => {});
const actUser = await authService.createUser("zz-act-user", "zz-act-password", "creator");
const token = (await authService.login("zz-act-user", "zz-act-password")).token;
const auth = { Authorization: `Bearer ${token}` };

async function store(text: string, deploy = true): Promise<string> {
  // Owned by the account that presses the buttons: a button reaches what its page's owner may
  // use (FX-17), and a notebook nobody owns reaches nothing. The ids are fixed and the rows
  // outlive a run, so the owner is set again each time rather than trusted from the last one.
  const saved = await notebooksService.save(fromMarkdown(text), "test", actUser.id);
  await pool.query("UPDATE notebooks SET owner_id = $1 WHERE id = $2", [actUser.id, saved.id]);
  if (deploy) await notebooksService.deploy(saved.id, "test");
  return saved.id;
}

const pageOf = async (name: string): Promise<NotebookPage> => {
  const pages = (await (await fetch(`${base}/api/notebooks/pages`, { headers: auth })).json()) as
    | NotebookPage[];
  const found = pages.find((page) => page.name === name);
  assert.ok(found, `"${name}" is not among the pages`);
  return found;
};

// ── reading the declaration ───────────────────────────────────────────────────

console.log("\nwhat counts as an action");

check("the three kinds are read, and nothing else is", () => {
  const specs = actionSpecs([
    { label: "Again", do: "rerun" },
    { label: "Call", do: "run", notebook: "somewhere" },
    { label: "Go", do: "link", url: "https://example.com" },
    { label: "Nope", do: "explode" } as unknown as NotebookAction,
  ]);
  assert.deepEqual(
    specs.map((action) => action.do),
    ["rerun", "run", "link"]
  );
});

check("an unlabelled action is not an action", () => {
  assert.equal(actionSpecs([{ label: "  ", do: "rerun" }]).length, 0);
});

check("a link that is really code is dropped, and said so", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<b>", "vbscript:x"]) {
    const action = [{ label: "Go", do: "link", url } as NotebookAction];
    assert.equal(actionSpecs(action).length, 0, `${url} survived`);
    assert.match(actionProblems(action).join(" "), /must start with/);
  }
});

check("a run with nothing to run is refused with the reason", () => {
  const action = [{ label: "Call", do: "run" } as NotebookAction];
  assert.equal(actionSpecs(action).length, 0);
  assert.match(actionProblems(action).join(" "), /needs a `notebook` to call/);
});

// ── what a button will ask for ────────────────────────────────────────────────

console.log("\nthe form a button asks for is the target's own");

await store(
  [
    "---",
    "name: zz-act-target",
    "id: zz-act-target-id",
    "runtime: node",
    "inputs:",
    "  - name: source",
    "    type: string",
    "  - name: pair",
    "    type: string",
    "  - name: note",
    "    type: string",
    "    multiline: true",
    "outputs: [ok]",
    "---",
    "",
    "```js",
    "return { ok: `${inputs.source}/${inputs.pair}/${inputs.note}` };",
    "```",
  ].join("\n")
);

await store(
  [
    "---",
    "name: zz-act-caller",
    "id: zz-act-caller-id",
    "runtime: node",
    "inputs:",
    "  - name: pair",
    "    type: string",
    "    default: USD_IDR",
    "outputs: [shown]",
    "actions:",
    "  - label: Archive it",
    "    do: run",
    "    notebook: zz-act-target",
    "    args:",
    "      source: caller",
    "---",
    "",
    "```js",
    "return { shown: inputs.pair };",
    "```",
  ].join("\n")
);

await check("a field the button fixes is never asked for", async () => {
  const page = await pageOf("zz-act-caller");
  const names = page.actions[0].asks?.map((input) => input.name) ?? [];
  assert.ok(!names.includes("source"), "`source` is fixed by args but was still asked");
  assert.deepEqual(names, ["pair", "note"]);
});

await check("what it does ask for is the target's declaration, unchanged", async () => {
  const page = await pageOf("zz-act-caller");
  const note = page.actions[0].asks?.find((input) => input.name === "note");
  // Not re-described by the caller: the control the target asked for is the control shown.
  assert.equal(note?.multiline, true);
});

await check("a target that takes nothing produces no form at all", async () => {
  await store(
    [
      "---",
      "name: zz-act-silent",
      "id: zz-act-silent-id",
      "runtime: node",
      "outputs: [ok]",
      "---",
      "",
      "```js",
      "return { ok: 1 };",
      "```",
    ].join("\n")
  );
  await store(
    [
      "---",
      "name: zz-act-caller-silent",
      "id: zz-act-caller-silent-id",
      "runtime: node",
      "outputs: [shown]",
      "actions:",
      "  - label: Just go",
      "    do: run",
      "    notebook: zz-act-silent",
      "---",
      "",
      "```js",
      "return { shown: 1 };",
      "```",
    ].join("\n")
  );

  const page = await pageOf("zz-act-caller-silent");
  assert.equal(page.actions[0].asks, undefined, "a dialog with nothing in it would open");
});

// ── the boundary ──────────────────────────────────────────────────────────────

console.log("\nwhat a page cannot reach");

await check("an action is named by position, so an unlisted notebook is unreachable", async () => {
  const caller = await notebooksService.findByIdOrName("zz-act-caller");
  assert.ok(caller && caller !== "ambiguous");

  // Index 1 does not exist: this page declares exactly one action.
  const res = await fetch(`${base}/api/notebooks/${caller.id}/actions/1`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(res.status, 404);
});

await check("arguments the target does not declare are dropped, not forwarded", async () => {
  const caller = await notebooksService.findByIdOrName("zz-act-caller");
  assert.ok(caller && caller !== "ambiguous");

  const res = await fetch(`${base}/api/notebooks/${caller.id}/actions/0`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      args: { pair: "USD_EUR", note: "typed", smuggled: "should not arrive" },
    }),
  });
  const body = (await res.json()) as { status: string; notebook: string };
  assert.equal(res.status, 200);
  assert.equal(body.status, "success");
  assert.equal(body.notebook, "zz-act-target");

  const target = await notebooksService.findByIdOrName("zz-act-target");
  assert.ok(target && target !== "ambiguous");
  const { rows } = await pool.query(
    "SELECT cell_results FROM notebook_runs WHERE notebook_id = $1 ORDER BY started_at DESC LIMIT 1",
    [target.id]
  );
  const results = rows[0]?.cell_results ?? {};
  const output = Object.values(results)[0] as { output?: Record<string, unknown> };
  // `source` came from the button, not the request, and `smuggled` never existed.
  assert.equal(output?.output?.ok, "caller/USD_EUR/typed");
});

await check("what the button fixed wins over what the request said", async () => {
  const caller = await notebooksService.findByIdOrName("zz-act-caller");
  assert.ok(caller && caller !== "ambiguous");

  await fetch(`${base}/api/notebooks/${caller.id}/actions/0`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ args: { source: "forged", pair: "X", note: "n" } }),
  });

  const target = await notebooksService.findByIdOrName("zz-act-target");
  assert.ok(target && target !== "ambiguous");
  const { rows } = await pool.query(
    "SELECT cell_results FROM notebook_runs WHERE notebook_id = $1 ORDER BY started_at DESC LIMIT 1",
    [target.id]
  );
  const output = Object.values(rows[0]?.cell_results ?? {})[0] as {
    output?: Record<string, unknown>;
  };
  assert.match(String(output?.output?.ok), /^caller\//, "a fixed argument was overridden");
});

await pool.query("DELETE FROM users WHERE username = 'zz-act-user'").catch(() => {});
await pool.end();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

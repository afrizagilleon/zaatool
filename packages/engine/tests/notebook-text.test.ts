/**
 * M6.1 — the notebook's text form.
 *
 * The bar is round-tripping without losing meaning, because every MCP tool speaks this
 * format: whatever an agent reads, edits and writes back must come home unchanged
 * except where it deliberately changed something.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-text.test.ts
 */
import assert from "node:assert/strict";
import { fromMarkdown, toMarkdown, NotebookTextError } from "../src/core/notebook-text.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import type { NotebookJson } from "@zaa-tool/shared";

let passed = 0;
let failed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n").join("\n       ")}`);
  }
}

const doc = (over: Partial<NotebookJson>): NotebookJson => ({
  version: "1.0",
  id: "nb-1",
  name: "Test",
  runtime: "node",
  steps: [],
  ...over,
});

/** Writing then reading must be the identity on meaning. */
function roundTrip(notebook: NotebookJson): NotebookJson {
  return fromMarkdown(toMarkdown(notebook));
}

function refuses(text: string, contains: string): void {
  try {
    fromMarkdown(text);
    assert.fail(`expected a refusal mentioning "${contains}"`);
  } catch (err) {
    assert.ok(err instanceof NotebookTextError, `expected NotebookTextError, got ${err}`);
    assert.ok(
      err.issues.some((issue) => issue.includes(contains)),
      `expected an issue mentioning "${contains}", got ${JSON.stringify(err.issues)}`
    );
  }
}

// ── round trips ───────────────────────────────────────────────────────────────

console.log("\nround trips");

check("a whole document survives writing and reading back", () => {
  const original = doc({
    name: "invoice-intake",
    runtime: "node",
    secrets: ["XENDIT_KEY", "SLACK_HOOK"],
    inputs: [
      { name: "invoiceId", type: "string", required: true, description: "the id to fetch" },
      { name: "retries", type: "number", default: 3 },
    ],
    outputs: ["total", "currency"],
    triggers: [
      { id: "t1", kind: "cron", cron: "0 9 * * *", enabled: true },
      { id: "t2", kind: "webhook", slug: "s-123", secretKey: "HOOK_SECRET", enabled: false },
    ],
    steps: [
      { id: "c1", kind: "cell", note: "# Fetch\nOnly the total matters.", code: "return { a: 1 };" },
      { id: "c2", kind: "cell", code: "return { b: a + 1 };", timeoutMs: 30000 },
    ],
  });

  assert.deepEqual(roundTrip(original), original);
});

check("parallel lanes and their labels survive", () => {
  const original = doc({
    steps: [
      { id: "c0", kind: "cell", code: "return { seed: 1 };" },
      {
        id: "p1",
        kind: "parallel",
        lanes: [
          { id: "l1", label: "fetch users", steps: [{ id: "c1", kind: "cell", code: "return { u: 1 };" }] },
          { id: "l2", label: "fetch orders", steps: [{ id: "c2", kind: "cell", code: "return { o: 2 };" }] },
        ],
      },
      { id: "c3", kind: "cell", code: "return { done: u + o };" },
    ],
  });

  assert.deepEqual(roundTrip(original), original);
});

check("a parallel group nested inside a lane survives", () => {
  const original = doc({
    steps: [
      {
        id: "p1",
        kind: "parallel",
        lanes: [
          {
            id: "l1",
            steps: [
              { id: "c1", kind: "cell", code: "return { a: 1 };" },
              {
                id: "p2",
                kind: "parallel",
                lanes: [{ id: "l2", steps: [{ id: "c2", kind: "cell", code: "return { b: 2 };" }] }],
              },
            ],
          },
          { id: "l3", steps: [{ id: "c3", kind: "cell", code: "return { c: 3 };" }] },
        ],
      },
    ],
  });

  assert.deepEqual(roundTrip(original), original);
});

check("fold state and timeout survive", () => {
  const original = doc({
    steps: [
      {
        id: "c1",
        kind: "cell",
        note: "folded",
        code: "return {};",
        timeoutMs: 5000,
        collapsed: { note: true, output: true },
      },
    ],
  });

  assert.deepEqual(roundTrip(original), original);
});

check("a note with no code and code with no note both survive", () => {
  const original = doc({
    steps: [
      { id: "c1", kind: "cell", note: "Just an explanation." },
      { id: "c2", kind: "cell", code: "return { x: 1 };" },
    ],
  });

  assert.deepEqual(roundTrip(original), original);
});

check("an empty code block stays empty rather than becoming absent", () => {
  const back = roundTrip(doc({ steps: [{ id: "c1", kind: "cell", code: "" }] }));
  assert.equal((back.steps[0] as { code?: string }).code, "");
});

check("python notebooks fence as python", () => {
  const original = doc({ runtime: "python", steps: [{ id: "c1", kind: "cell", code: "return {'a': 1}" }] });
  assert.ok(toMarkdown(original).includes("```python"));
  assert.deepEqual(roundTrip(original), original);
});

// ── the awkward content ───────────────────────────────────────────────────────

console.log("\nawkward content");

check("a note containing its own fenced example is not mistaken for the cell's code", () => {
  const note = "Call it like this:\n\n```js\nnotebooks.run('x')\n```\n\nThat is all.";
  const original = doc({ steps: [{ id: "c1", kind: "cell", note, code: "return { real: true };" }] });

  const back = roundTrip(original);
  assert.deepEqual(back, original);
  assert.equal((back.steps[0] as { code?: string }).code, "return { real: true };");
});

check("code holding a triple backtick is not truncated", () => {
  const code = "const md = `\\n```js\\ninner\\n```\\n`;\nreturn { md };";
  const original = doc({ steps: [{ id: "c1", kind: "cell", code }] });
  assert.deepEqual(roundTrip(original), original);
});

check("a marker written inside code is read as code, not as structure", () => {
  const code = "// <!-- zaa:cell id=fake -->\nreturn { ok: 1 };";
  const back = roundTrip(doc({ steps: [{ id: "c1", kind: "cell", code }] }));
  assert.equal(back.steps.length, 1);
  assert.equal((back.steps[0] as { code?: string }).code, code);
});

check("a label with spaces survives quoting", () => {
  const original = doc({
    steps: [
      {
        id: "p1",
        kind: "parallel",
        lanes: [{ id: "l1", label: 'kirim "email" ke tim', steps: [{ id: "c1", kind: "cell", code: "" }] }],
      },
    ],
  });
  const back = roundTrip(original);
  assert.equal((back.steps[0] as { lanes: { label?: string }[] }).lanes[0].label, 'kirim "email" ke tim');
});

// ── writing by hand ───────────────────────────────────────────────────────────

console.log("\nwriting by hand");

check("the simplest thing an agent writes is read as one cell", () => {
  const notebook = fromMarkdown(
    ["---", "name: hello", "---", "", "Say hello.", "", "```js", 'return { greeting: "hi" };', "```"].join("\n")
  );

  assert.equal(notebook.name, "hello");
  assert.equal(notebook.runtime, "node");
  assert.equal(notebook.steps.length, 1);
  assert.equal((notebook.steps[0] as { note?: string }).note, "Say hello.");
  assert.equal((notebook.steps[0] as { code?: string }).code, 'return { greeting: "hi" };');
});

check("a missing id is generated, and a supplied fallback is preferred", () => {
  const front = ["---", "name: hello", "---", ""].join("\n");
  assert.match(fromMarkdown(front).id, /^[0-9a-f-]{36}$/);
  assert.equal(fromMarkdown(front, { id: "nb-existing" }).id, "nb-existing");
});

check("ids in the text win over the fallback, so history stays attached", () => {
  const text = ["---", "name: hello", "id: nb-real", "---", "", "<!-- zaa:cell id=keep-me -->", ""].join("\n");
  const notebook = fromMarkdown(text, { id: "nb-other" });
  assert.equal(notebook.id, "nb-real");
  assert.equal(notebook.steps[0].id, "keep-me");
});

check("a webhook without a slug gets an unguessable one", () => {
  const text = ["---", "name: hooked", "triggers:", "  - { kind: webhook }", "---", ""].join("\n");
  const trigger = fromMarkdown(text).triggers?.[0] as { slug: string };
  assert.match(trigger.slug, /^[0-9a-f-]{36}$/);
});

check("rewriting a notebook keeps the webhook slug it already had", () => {
  const previous = doc({
    name: "hooked",
    triggers: [{ id: "t1", kind: "webhook", slug: "the-live-url", secretKey: "HOOK" }],
  });
  const text = ["---", "name: hooked", "triggers:", "  - { kind: webhook }", "---", ""].join("\n");

  const trigger = fromMarkdown(text, { previous }).triggers?.[0] as { id: string; slug: string };
  assert.equal(trigger.slug, "the-live-url", "the public URL changed under the caller");
  assert.equal(trigger.id, "t1");
});

check("a cron keeps its identity across a rewrite, so a reschedule reads as one change", () => {
  const previous = doc({ triggers: [{ id: "t1", kind: "cron", cron: "0 9 * * *" }] });
  const text = ["---", "name: Test", "triggers:", '  - { kind: cron, cron: "0 18 * * *" }', "---", ""].join("\n");

  const trigger = fromMarkdown(text, { previous }).triggers?.[0] as { id: string; cron: string };
  assert.equal(trigger.id, "t1");
  assert.equal(trigger.cron, "0 18 * * *");
});

check("two webhooks keep their own slugs, in order", () => {
  const previous = doc({
    triggers: [
      { id: "t1", kind: "webhook", slug: "first" },
      { id: "t2", kind: "webhook", slug: "second" },
    ],
  });
  const text = [
    "---",
    "name: Test",
    "triggers:",
    "  - { kind: webhook }",
    "  - { kind: webhook }",
    "---",
    "",
  ].join("\n");

  const triggers = fromMarkdown(text, { previous }).triggers as { slug: string }[];
  assert.deepEqual(
    triggers.map((trigger) => trigger.slug),
    ["first", "second"]
  );
});

check("an added webhook does not steal the existing one's slug", () => {
  const previous = doc({ triggers: [{ id: "t1", kind: "webhook", slug: "the-live-url" }] });
  const text = [
    "---",
    "name: Test",
    "triggers:",
    "  - { kind: webhook, slug: the-live-url }",
    "  - { kind: webhook }",
    "---",
    "",
  ].join("\n");

  const triggers = fromMarkdown(text, { previous }).triggers as { slug: string }[];
  assert.equal(triggers[0].slug, "the-live-url");
  assert.match(triggers[1].slug, /^[0-9a-f-]{36}$/);
  assert.notEqual(triggers[1].slug, triggers[0].slug);
});

check("cells written without ids each get their own", () => {
  const text = [
    "---",
    "name: two",
    "---",
    "",
    "<!-- zaa:cell -->",
    "first",
    "",
    "<!-- zaa:cell -->",
    "second",
  ].join("\n");

  const notebook = fromMarkdown(text);
  assert.equal(notebook.steps.length, 2);
  assert.notEqual(notebook.steps[0].id, notebook.steps[1].id);
});

// ── refusals ──────────────────────────────────────────────────────────────────

console.log("\nrefusals");

check("a document with no front matter is refused", () => {
  refuses("just some text", "front matter");
});

check("front matter that is never closed is refused", () => {
  refuses("---\nname: x\n", "never closed");
});

check("a document with no name is refused", () => {
  refuses("---\nruntime: node\n---\n", "must set `name`");
});

check("an unknown runtime is refused rather than guessed", () => {
  refuses("---\nname: x\nruntime: ruby\n---\n", "runtime");
});

check("an input with an unknown type is refused", () => {
  refuses("---\nname: x\ninputs:\n  - { name: a, type: date }\n---\n", "expected one of");
});

check("an input with no name is refused", () => {
  refuses("---\nname: x\ninputs:\n  - { type: string }\n---\n", "needs a `name`");
});

check("a cron trigger with no expression is refused", () => {
  refuses("---\nname: x\ntriggers:\n  - { kind: cron }\n---\n", "needs a `cron`");
});

check("an unclosed parallel group is refused", () => {
  refuses(
    ["---", "name: x", "---", "", "<!-- zaa:parallel id=p1 -->", "<!-- zaa:lane id=l1 -->", "<!-- zaa:cell -->"].join("\n"),
    "never closed"
  );
});

check("a lane outside a parallel group is refused", () => {
  refuses(["---", "name: x", "---", "", "<!-- zaa:lane id=l1 -->"].join("\n"), "outside a parallel group");
});

check("a cell placed directly in a parallel group is refused", () => {
  refuses(
    ["---", "name: x", "---", "", "<!-- zaa:parallel id=p1 -->", "<!-- zaa:cell -->", "<!-- zaa:end -->"].join("\n"),
    "put it in a lane"
  );
});

check("an empty lane is refused, because the compiler depends on it", () => {
  refuses(
    ["---", "name: x", "---", "", "<!-- zaa:parallel id=p1 -->", "<!-- zaa:lane id=l1 -->", "<!-- zaa:end -->"].join("\n"),
    "has no cells"
  );
});

check("a parallel group with no lanes is refused", () => {
  refuses(
    ["---", "name: x", "---", "", "<!-- zaa:parallel id=p1 -->", "<!-- zaa:end -->"].join("\n"),
    "has no lanes"
  );
});

check("every issue in one document is reported together", () => {
  try {
    fromMarkdown("---\nruntime: ruby\noutputs: 5\n---\n");
    assert.fail("expected a refusal");
  } catch (err) {
    assert.ok(err instanceof NotebookTextError);
    assert.ok(err.issues.length >= 3, `expected several issues, got ${JSON.stringify(err.issues)}`);
  }
});

// ── the document the compiler sees ────────────────────────────────────────────

console.log("\nstill a real notebook");

check("a hand-written document compiles", () => {
  const notebook = fromMarkdown(
    [
      "---",
      "name: compiles",
      "runtime: node",
      "outputs: [total]",
      "---",
      "",
      "<!-- zaa:cell -->",
      "Seed the scope.",
      "",
      "<!-- zaa:code -->",
      "```js",
      "return { total: 1 };",
      "```",
      "",
      "<!-- zaa:parallel -->",
      "",
      "<!-- zaa:lane label=left -->",
      "",
      "<!-- zaa:cell -->",
      "<!-- zaa:code -->",
      "```js",
      "return { l: total + 1 };",
      "```",
      "",
      "<!-- zaa:lane label=right -->",
      "",
      "<!-- zaa:cell -->",
      "<!-- zaa:code -->",
      "```js",
      "return { r: total + 2 };",
      "```",
      "",
      "<!-- zaa:end -->",
    ].join("\n")
  );

  const plan = compileNotebook(notebook);
  assert.deepEqual(plan.outputs, ["total"]);
  assert.ok(plan.steps.length > 0, "the plan has steps");
});

/**
 * What a person arranged must survive what an agent rewrites.
 *
 * Every MCP write replaces the whole document, because that is the only verb an agent
 * has. A small model reproducing five thousand tokens to change one field will drop
 * whatever it was not thinking about — and it did: asked to add a button, it deleted two
 * others and a hand-arranged grid, and said nothing. These checks are the rule that
 * stops that: absent means keep, empty means clear.
 */
console.log("\nomission is not deletion");

const arranged = doc({
  outputs: ["total"],
  layout: [{ i: "total", x: 0, y: 0, w: 6, h: 4 }],
  actions: [
    { label: "Again", do: "rerun" },
    { label: "Docs", do: "link", url: "https://example.com" },
  ],
  steps: [{ id: "c1", kind: "cell", code: "return { total: 1 };" }],
});

/** What an agent writes when it is thinking about the code and nothing else. */
const rewriteWithoutThem = [
  "---",
  "name: Test",
  "runtime: node",
  "id: nb-1",
  "outputs: [total]",
  "---",
  "",
  "```js",
  "return { total: 2 };",
  "```",
].join("\n");

check("a hand-arranged layout survives a rewrite that never mentions it", () => {
  const after = fromMarkdown(rewriteWithoutThem, { previous: arranged });
  assert.deepEqual(after.layout, arranged.layout);
});

check("declared buttons survive a rewrite that never mentions them", () => {
  const after = fromMarkdown(rewriteWithoutThem, { previous: arranged });
  assert.deepEqual(after.actions, arranged.actions);
});

check("and the rewrite still takes effect everywhere it did speak", () => {
  const after = fromMarkdown(rewriteWithoutThem, { previous: arranged });
  const cell = after.steps[0] as { code: string };
  assert.match(cell.code, /total: 2/, "the code it did write was not applied");
});

check("an explicit empty list clears them — that is how an agent removes one", () => {
  const text = rewriteWithoutThem.replace(
    "outputs: [total]",
    "outputs: [total]\nactions: []\nlayout: []"
  );
  const after = fromMarkdown(text, { previous: arranged });
  assert.equal(after.actions, undefined, "`actions: []` did not clear them");
  assert.equal(after.layout, undefined, "`layout: []` did not clear it");
});

check("saying something replaces, rather than merges", () => {
  const text = rewriteWithoutThem.replace(
    "outputs: [total]",
    "outputs: [total]\nactions:\n  - label: Only this\n    do: rerun"
  );
  const after = fromMarkdown(text, { previous: arranged });
  assert.deepEqual(after.actions, [{ label: "Only this", do: "rerun" }]);
});

check("nothing is invented for a notebook that never had any", () => {
  const after = fromMarkdown(rewriteWithoutThem);
  assert.equal(after.actions, undefined);
  assert.equal(after.layout, undefined);
});

check("a round trip through the text form keeps both", () => {
  const after = roundTrip(arranged);
  assert.deepEqual(after.layout, arranged.layout);
  assert.deepEqual(after.actions, arranged.actions);
});

// ── tags ──────────────────────────────────────────────────────────────────────
// A field that survives a round trip in the browser but not here is a field an agent
// silently deletes: it reads the notebook, edits one cell, writes it back, and the tags
// are gone. The same trap `packages` fell into, checked the same way.

check("tags survive a round trip", () => {
  const after = roundTrip(doc({ tags: ["finance", "daily"] }));
  assert.deepEqual(after.tags, ["finance", "daily"]);
});

check("two spellings of one tag never become two tags", () => {
  const after = roundTrip(doc({ tags: ["Finance", " finance ", "DAILY"] }));
  assert.deepEqual(after.tags, ["finance", "daily"]);
});

check("a tag with a space in it is refused rather than quietly kept", () => {
  // It would become one label that no filter can ever match by clicking, and the author
  // is reading this answer now rather than discovering it in a list next week.
  refuses(
    toMarkdown(doc({})).replace("version:", "tags: ['daily report']\nversion:"),
    "cannot contain spaces"
  );
});

check("a notebook with no tags grows none", () => {
  assert.equal(roundTrip(doc({})).tags, undefined);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

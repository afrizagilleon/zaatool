/**
 * What a model actually sends.
 *
 * This file exists because of one failure and one rule that came out of it.
 *
 * The failure: asked to change a single cell, Hermes called `notebook_edit_cell` with
 * ```` ```js const … ```` — code wrapped in a markdown fence, because a fence is how a
 * language model has marked code its entire life. It was stored verbatim, it **passed
 * `compileNotebook`**, and the tool answered "Compiles." The notebook was broken from that
 * moment and said nothing until somebody ran it. The agent, seeing something had gone
 * wrong, fell back to rewriting the whole notebook — the exact cost `notebook_edit_cell`
 * was built to remove.
 *
 * The rule (R-3 in the repair plan): **a test of an agent tool must send what a model
 * sends.** Every existing test sent `"return { total: 1 };"` — clean code, because that is
 * what was in my head while writing the tool. A test that only sends the input I imagined
 * is a test of my imagination.
 *
 * So this is a corpus, not a scenario. Each case is a shape a model has produced or
 * plausibly will, and the claim under test is the same for all of them: **either it is
 * understood, or it is refused — never stored broken.**
 *
 *   pnpm --filter @zaa-tool/engine test agent-inputs
 */
import assert from "node:assert/strict";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { applyCellEdit, CellEditError } from "../src/core/notebook-edit.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import { stripCodeFence, codeSyntaxProblem, pythonSyntaxProblem } from "../src/core/cell-code.js";

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

const BACKTICK = "`";
const FENCE = BACKTICK.repeat(3);

function notebook(runtime: "node" | "python" = "node") {
  return fromMarkdown(
    [
      "---",
      "name: zz-agent-inputs",
      "id: zz-agent-inputs-id",
      `runtime: ${runtime}`,
      "---",
      "",
      // Pinned, or `fromMarkdown` mints a fresh id on every call and no two fixtures
      // in this file would agree on which cell to edit.
      "<!-- zaa:cell id=zz-agent-cell -->",
      "<!-- zaa:code -->",
      FENCE + (runtime === "python" ? "python" : "js"),
      runtime === "python" ? "return {'a': 1}" : "return { a: 1 };",
      FENCE,
    ].join("\n")
  );
}

const CELL = "zz-agent-cell";

/** Replaces the one cell with `code`, and hands back what was stored. */
function stored(code: string, runtime: "node" | "python" = "node"): string {
  const edited = applyCellEdit(notebook(runtime), { action: "replace", cell: CELL, code });
  const step = edited.steps[0] as { code?: string };
  return step.code ?? "";
}

// ── the fence, in every shape a model writes it ───────────────────────────────

console.log("\nthe wrapping a model reaches for");

check("the exact call that failed is now understood", () => {
  // Reconstructed from the transcript: ```js, a newline, the code, a closing fence.
  const sent = `${FENCE}js\nconst rate = 16240;\nreturn { rate };\n${FENCE}`;
  assert.equal(stored(sent), "const rate = 16240;\nreturn { rate };");
});

check("every language tag a model might use", () => {
  for (const tag of ["js", "javascript", "JS", "node", ""]) {
    const sent = `${FENCE}${tag}\nreturn { a: 1 };\n${FENCE}`;
    assert.equal(stored(sent), "return { a: 1 };", `tag "${tag}" was not unwrapped`);
  }
});

check("a longer fence, which a model uses when the code contains one", () => {
  const long = BACKTICK.repeat(5);
  assert.equal(stored(`${long}js\nreturn { a: 1 };\n${long}`), "return { a: 1 };");
});

check("tildes, which some models prefer", () => {
  assert.equal(stored("~~~js\nreturn { a: 1 };\n~~~"), "return { a: 1 };");
});

check("leading blank lines and trailing whitespace around the fence", () => {
  assert.equal(stored(`\n  ${FENCE}js\nreturn { a: 1 };\n${FENCE}  \n\n`), "return { a: 1 };");
});

check("windows line endings are normalised, not carried into the cell", () => {
  // A trailing `\r` is invisible in every view of the code and perfectly capable of
  // breaking a template literal, so it is removed rather than preserved faithfully.
  assert.equal(
    stored(`${FENCE}js\r\nconst a = 1;\r\nreturn { a };\r\n${FENCE}`),
    "const a = 1;\nreturn { a };"
  );
});

check("python is unwrapped too, not just javascript", () => {
  assert.equal(stored(`${FENCE}python\nreturn {'a': 1}\n${FENCE}`, "python"), "return {'a': 1}");
});

// ── what must not be unwrapped ────────────────────────────────────────────────

console.log("\nwhat is not a wrapper");

check("a fence inside a template literal is left alone", () => {
  // The code legitimately builds a markdown block. Stripping here would corrupt it.
  const code = `const doc = \`${FENCE}js\\nconsole.log(1)\\n${FENCE}\`;\nreturn { doc };`;
  assert.equal(stripCodeFence(code), code);
});

check("an unclosed fence is not treated as a wrapper", () => {
  const code = `${FENCE}js\nreturn { a: 1 };`;
  assert.equal(stripCodeFence(code), code, "half a fence was silently removed");
});

check("ordinary code is untouched, byte for byte", () => {
  const code = "const a = 1;\n// a comment with ``` in it\nreturn { a };";
  assert.equal(stripCodeFence(code), code);
});

// ── nothing broken is stored ──────────────────────────────────────────────────

console.log("\nnothing broken reaches the document");

check("an unclosed fence is refused rather than saved", () => {
  assert.throws(
    () => stored(`${FENCE}js\nreturn { a: 1 };`),
    /markdown fence/i,
    "a cell that is half a fence was accepted"
  );
});

check("code that does not parse is refused, with the parser's reason", () => {
  assert.throws(() => stored("return { a: ;"), CellEditError);
  assert.throws(() => stored("if (true) {"), /does not parse/);
});

check("the position reported is the cell's own, not the wrapper's", () => {
  // It used to say "column 103" for a mistake on the first line, because the wrapper
  // shared that line. A position an agent cannot map onto the code it sent is noise.
  const problem = codeSyntaxProblem("return { a: ;", "node");
  assert.ok(problem);
  assert.match(problem, /line 1, column 1[23]\b/, problem);

  const second = codeSyntaxProblem("const a = 1;\nreturn { b: ;", "node");
  assert.ok(second);
  assert.match(second, /line 2/, second);
});

check("the refusal happens before anything is applied", () => {
  const before = notebook();
  const original = (before.steps[0] as { code?: string }).code;
  try {
    applyCellEdit(before, { action: "replace", cell: CELL, code: "return {" });
    assert.fail("it was accepted");
  } catch {
    assert.equal((before.steps[0] as { code?: string }).code, original, "the document was mutated");
  }
});

check("a cell that is only a fence used to compile — now it cannot exist", () => {
  // The precise regression. Before: stored, compiled, reported as success.
  const onlyFence = `${FENCE}js\nreturn { a: 1 };\n${FENCE}`;
  const edited = applyCellEdit(notebook(), { action: "replace", cell: CELL, code: onlyFence });
  const code = (edited.steps[0] as { code?: string }).code ?? "";
  assert.ok(!code.includes(FENCE), "a fence survived into the document");
  compileNotebook(edited);
});

// ── the syntax check itself ───────────────────────────────────────────────────

console.log("\nthe check that was missing");

check("javascript is checked the way the worker will run it", () => {
  assert.equal(codeSyntaxProblem("return { a: 1 };", "node"), null);
  assert.equal(codeSyntaxProblem("const x = await Promise.resolve(1); return { x };", "node"), null);
  // `inputs`, `files` and `notebooks` are parameters there, so they must parse here.
  assert.equal(codeSyntaxProblem("return { a: inputs.b, c: typeof files };", "node"), null);
  assert.ok(codeSyntaxProblem("return {", "node"));
});

check("an empty cell is not an error", () => {
  assert.equal(codeSyntaxProblem("", "node"), null);
  assert.equal(codeSyntaxProblem("   \n  ", "node"), null);
});

check("python is not checked by the synchronous path, because only python can", () => {
  assert.equal(codeSyntaxProblem("this is not python(", "python"), null);
});

await check("python is checked, by python", async () => {
  assert.equal(await pythonSyntaxProblem("return {'a': 1}"), null);
  assert.equal(await pythonSyntaxProblem("x = [1, 2]\nreturn {'n': len(x)}"), null);

  // Wrapped as `python-runner` wraps it, so a bare `return` is legal and this is not a
  // check that refuses every well-formed cell in the workspace.
  const problem = await pythonSyntaxProblem("return {'a': ");
  assert.ok(problem, "broken python was accepted");
  assert.match(problem, /SyntaxError/i);
});

await check("a fenced python cell is named as a fence, not as mystery syntax", async () => {
  const problem = await pythonSyntaxProblem(`${FENCE}python\nreturn {'a': 1}\n${FENCE}`);
  assert.ok(problem);
  assert.match(problem, /markdown fence/i);
});

// ── other shapes a model sends ────────────────────────────────────────────────

console.log("\nother things a model does");

check("a note sent with a fence is not code and keeps its fence", () => {
  // Prose is markdown, so a fence in a note is legitimate content.
  const edited = applyCellEdit(notebook(), {
    action: "replace",
    cell: CELL,
    note: `Example:\n\n${FENCE}js\nfoo()\n${FENCE}`,
  });
  const note = (edited.steps[0] as { note?: string }).note ?? "";
  assert.ok(note.includes(FENCE), "a fence was stripped from prose, where it belongs");
});

check("changing only the note leaves the code exactly as it was", () => {
  const edited = applyCellEdit(notebook(), { action: "replace", cell: CELL, note: "New note." });
  assert.equal((edited.steps[0] as { code?: string }).code, "return { a: 1 };");
});

check("an appended cell is checked too, not only a replaced one", () => {
  assert.throws(
    () => applyCellEdit(notebook(), { action: "append", code: `${FENCE}js\nreturn {` }),
    CellEditError
  );
});

check("an inserted cell is checked too", () => {
  assert.throws(
    () => applyCellEdit(notebook(), { action: "insert_after", cell: CELL, code: "return { a: ;" }),
    CellEditError
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

import assert from "node:assert/strict";
import { jsSyntaxProblem } from "../src/core/cell-analysis.js";
import { stripCodeFence } from "../src/core/cell-code.js";
import { prepareOwnerHome } from "../src/core/owner-home.js";
import { fakeWorkspaceFs } from "./fake-workspace-fs.js";
import {
  closesFence,
  collapseTrailingBlankLines,
  parseAttributePairs,
  parseFenceLine,
  parseMarkerLine,
  stripLocationSuffix,
  trimChars,
  trimEndChars,
} from "../src/core/linear-text.js";
import { toolNameFor } from "../src/core/notebook-tool-name.js";
import { fromMarkdown, toMarkdown } from "../src/core/notebook-text.js";
import { ownerHomePath } from "../src/core/sandbox-identity.js";
import { safeFilename } from "../src/core/storage-paths.js";

/**
 * FX-23: the regular expressions SonarCloud marked as super-linear are now plain scans.
 *
 * Two kinds of test. A hostile input of 50,000 characters, shaped to make the old pattern
 * retry from every start, must finish in under 100 ms. And on thousands of short random
 * inputs the new code must give exactly the answer the old pattern gave, which is kept here
 * as the reference.
 */
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

const BIG = 50_000;
const LIMIT_MS = 100;

function within<T>(label: string, run: () => T): T {
  const started = performance.now();
  const result = run();
  const took = performance.now() - started;
  assert.ok(took < LIMIT_MS, `${label} took ${took.toFixed(1)} ms for ${BIG} characters (limit ${LIMIT_MS})`);
  return result;
}

// ── deterministic pseudo-random strings ───────────────────────────────────────

let seed = 20261120;
function random(limit: number): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed % limit;
}
function sample(alphabet: string[], maxLength: number, count = 4000): string[] {
  const out: string[] = [""];
  for (let n = 0; n < count; n += 1) {
    let text = "";
    for (let length = random(maxLength + 1); length > 0; length -= 1) text += alphabet[random(alphabet.length)];
    out.push(text);
  }
  return out;
}

// ── the patterns as they were, for comparison ─────────────────────────────────

const oldStripLocation = (message: string) => message.replace(/\s*\(\d+:\d+\)\s*$/, "");
const OLD_FENCE_OPEN = /^\s*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n/;
function oldStripFence(code: string): string {
  const text = String(code ?? "").replace(/\r\n/g, "\n");
  const open = OLD_FENCE_OPEN.exec(text);
  if (!open) return text;
  const marker = open[1][0];
  const length = open[1].length;
  const body = text.slice(open[0].length);
  const close = new RegExp(`\\r?\\n?[ \\t]*\\${marker}{${length},}[ \\t]*\\s*$`);
  const closed = close.exec(body);
  if (!closed) return text;
  return body.slice(0, closed.index);
}
const oldMarker = (line: string) => /^\s*<!--\s*zaa:([a-z]+)\s*(.*?)\s*-->\s*$/.exec(line);
const oldFence = (line: string) => /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const oldClosing = (marker: string, length: number, line: string) =>
  new RegExp(`^\\s{0,3}\\${marker}{${length},}\\s*$`).test(line);
function oldAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of text.matchAll(/([a-zA-Z]+)=("((?:[^"\\]|\\.)*)"|\S+)/g)) {
    attrs[match[1]] = match[3] !== undefined ? match[3].replace(/\\(.)/g, "$1") : match[2];
  }
  return attrs;
}
function newAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const pair of parseAttributePairs(text)) {
    attrs[pair.key] = pair.quoted !== undefined ? pair.quoted.replace(/\\(.)/g, "$1") : (pair.bare ?? "");
  }
  return attrs;
}

// ── hostile input ─────────────────────────────────────────────────────────────

await check("jsSyntaxProblem: location suffix is removed, and a long whitespace tail is cheap", () => {
  assert.equal(stripLocationSuffix("Unexpected token (3:14)"), "Unexpected token");
  assert.equal(stripLocationSuffix("Unexpected token (3:14)  "), "Unexpected token");
  assert.equal(stripLocationSuffix("Unexpected token"), "Unexpected token");
  assert.equal(stripLocationSuffix("Unexpected (token)"), "Unexpected (token)");
  assert.match(jsSyntaxProblem("let = ;") ?? "", /Unexpected/);
  assert.equal(within("stripLocationSuffix", () => stripLocationSuffix(`x${" ".repeat(BIG)}y`)).length, BIG + 2);
  assert.equal(within("stripLocationSuffix", () => stripLocationSuffix(`x${" ".repeat(BIG)}(`)).length, BIG + 2);
});

await check("stripCodeFence: normal fences, and hostile runs of spaces", () => {
  assert.equal(stripCodeFence("```js\nreturn 1;\n```"), "return 1;");
  assert.equal(stripCodeFence("  ~~~~\nreturn 1;\n~~~~  \n"), "return 1;");
  assert.equal(stripCodeFence("```js\r\nreturn 1;\r\n```\r\n"), "return 1;");
  assert.equal(stripCodeFence("return 1;"), "return 1;");
  assert.equal(stripCodeFence("```js\nreturn 1;"), "```js\nreturn 1;");
  within("open fence", () => stripCodeFence(`\`\`\`${" ".repeat(BIG)}x`));
  within("open fence, whitespace first", () => stripCodeFence(`${" ".repeat(BIG)}x`));
  within("close fence", () => stripCodeFence(`\`\`\`js\nx${" ".repeat(BIG)}y`));
  within("close fence, tabs", () => stripCodeFence(`\`\`\`js\nx${"\t ".repeat(BIG / 2)}y`));
  within("close fence, trailing ticks", () => stripCodeFence(`\`\`\`js\nx${"`".repeat(BIG)}\``.slice(0, -1) + "y"));
});

await check("prepareOwnerHome and ownerHomePath: trailing slashes on a long home", () => {
  assert.equal(ownerHomePath({ home: "/home/sandbox///", uidBase: 1, uidCount: 1, gid: 1 }, 7), "/home/sandbox/owners/7");
  const wfs = fakeWorkspaceFs().fs;
  const home = within("prepareOwnerHome", () =>
    prepareOwnerHome({ home: `/h${"/".repeat(BIG)}x`, uidBase: 1, uidCount: 1, gid: 1 }, 3, wfs)
  );
  assert.ok(home.endsWith("/owners/3"));
  assert.equal(
    within("ownerHomePath", () => ownerHomePath({ home: `/h${"/".repeat(BIG)}`, uidBase: 1, uidCount: 1, gid: 1 }, 3)),
    "/h/owners/3"
  );
  assert.equal(
    within("ownerHomePath, slashes then text", () =>
      ownerHomePath({ home: `${"/".repeat(BIG)}x`, uidBase: 1, uidCount: 1, gid: 1 }, 3)
    ).length,
    BIG + 10
  );
});

await check("toolNameFor: a long title is cut, and edges are trimmed", () => {
  assert.equal(toolNameFor("  Hello, World!  "), "run_hello_world");
  assert.equal(toolNameFor("___"), "");
  assert.equal(toolNameFor("--a--b--"), "run_a_b");
  assert.equal(within("toolNameFor", () => toolNameFor(`-${"a-".repeat(BIG / 2)}`)).length, 4 + 47 + 1);
  assert.equal(within("toolNameFor, symbols", () => toolNameFor("-".repeat(BIG) + "a")), "run_a");
});

await check("safeFilename: trailing dots and spaces on a long name", () => {
  assert.equal(safeFilename("report. . "), "report");
  assert.equal(safeFilename("...hidden.txt"), "hidden.txt");
  assert.equal(safeFilename(". . "), "file");
  assert.ok(within("safeFilename", () => safeFilename(`a${". ".repeat(BIG / 2)}b`)).startsWith("a. . "));
  assert.ok(within("safeFilename, spaces", () => safeFilename(`a${" ".repeat(BIG)}b`)).startsWith("a  "));
});

await check("trim helpers", () => {
  assert.equal(trimEndChars("abc///", "/"), "abc");
  assert.equal(trimEndChars("///", "/"), "");
  assert.equal(trimChars("__a_b__", "_"), "a_b");
  assert.equal(collapseTrailingBlankLines("a\n\n\n\n"), "a\n");
  assert.equal(collapseTrailingBlankLines("a\n\n"), "a\n\n");
  assert.equal(within("collapse", () => collapseTrailingBlankLines(`${"\n".repeat(BIG)}x`)).length, BIG + 1);
});

await check("notebook text: writing a note, code and blank lines at the end", () => {
  const notebook = {
    name: "N",
    runtime: "node",
    steps: [
      { kind: "cell", id: "a", note: `note${" ".repeat(BIG)}\n\n`, code: `return 1;${"\n".repeat(BIG)}` },
      { kind: "cell", id: "b", note: `x${" ".repeat(BIG)}y`, code: `${"\n".repeat(BIG)}z` },
    ],
  } as unknown as Parameters<typeof toMarkdown>[0];
  const text = within("toMarkdown", () => toMarkdown(notebook));
  assert.ok(text.includes("return 1;\n```"));
  assert.ok(!text.includes("note \n"), "trailing spaces of the note are gone");
});

await check("notebook text: reading hostile marker, fence and attribute lines", () => {
  const front = "---\nname: T\nruntime: node\n---\n\n";
  const read = (body: string) => {
    try {
      fromMarkdown(front + body);
    } catch {
      /* a refusal is fine; this is about time */
    }
  };
  within("marker spaces", () => read(`<!-- zaa:cell ${" ".repeat(BIG)}x\n`));
  within("marker dashes", () => read(`<!-- zaa:cell ${"-->".repeat(BIG / 3)} x\n`));
  within("marker letters", () => read(`<!-- zaa:cell ${"a".repeat(BIG)} -->\n`));
  within("marker name", () => read(`<!-- zaa:${"a".repeat(BIG)}1 -->\n`));
  within("attribute letters", () => read(`<!-- zaa:cell ${"a".repeat(BIG)} -->\n`));
  within("attribute quotes", () => read(`<!-- zaa:cell id="${"\\a".repeat(BIG / 2)} -->\n`));
  within("fence line", () => read(`\`\`\`${"`".repeat(BIG)}x\n`));
  within("closing fence", () => read(`\`\`\`js\n${"`".repeat(BIG)} x\n`));
  within("closing spaces", () => read(`\`\`\`js\n${" ".repeat(BIG)}x\n`));
  const ok = fromMarkdown(
    `${front}<!-- zaa:cell id=a timeout=500 -->\n\nSome note.\n\n<!-- zaa:code -->\n\n\`\`\`js\nreturn 1;\n\`\`\`\n`
  );
  assert.equal((ok.steps?.[0] as { id: string }).id, "a");
});

// ── same answers as the old patterns ──────────────────────────────────────────

await check("same answer: location suffix", () => {
  for (const text of sample(["(", ")", ":", "1", "23", "a", " ", "\n", "\t"], 10)) {
    assert.equal(stripLocationSuffix(text), oldStripLocation(text), JSON.stringify(text));
  }
});

await check("same answer: opening and closing code fence", () => {
  const alphabet = ["`", "`", "~", "~", " ", "\t", "\n", "\r", "a", "js", "-", "x"];
  for (const text of sample(alphabet, 14, 8000)) {
    assert.equal(stripCodeFence(text), oldStripFence(text), JSON.stringify(text));
  }
});

await check("same answer: marker, fence and closing-fence lines", () => {
  for (const line of sample(["<!--", "-->", "zaa:", "cell", "a", "z", "1", " ", "\t", "\r", "=", '"', "-", "X"], 9, 9000)) {
    const old = oldMarker(line);
    const now = parseMarkerLine(line);
    assert.deepEqual(now, old ? { name: old[1], attrs: old[2] } : null, JSON.stringify(line));
  }
  for (const line of sample(["`", "~", " ", "\t", "\r", "a", " "], 10, 9000)) {
    const old = oldFence(line);
    const now = parseFenceLine(line);
    assert.deepEqual(now, old ? { marker: old[1][0], length: old[1].length } : null, JSON.stringify(line));
    for (const [marker, length] of [["`", 3], ["`", 4], ["~", 3]] as const) {
      assert.equal(closesFence(line, marker, length), oldClosing(marker, length, line), JSON.stringify([line, marker, length]));
    }
  }
});

await check("same answer: attribute pairs", () => {
  for (const text of sample(["a", "b", "=", '"', "\\", " ", "x", "1", "\n", "-"], 12, 12000)) {
    assert.deepEqual(newAttributes(text), oldAttributes(text), JSON.stringify(text));
  }
  assert.deepEqual(newAttributes('id=a-1 label="two words" timeout=500'), { id: "a-1", label: "two words", timeout: "500" });
  assert.deepEqual(newAttributes('label="say \\"hi\\""'), { label: 'say "hi"' });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

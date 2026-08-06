/**
 * Where the engine and the editor have to agree.
 *
 * This is the only file in the repository that reaches across the two packages, and it is
 * deliberate: `packages/shared` is the sole channel between them at run time precisely so
 * that neither imports the other, and the cost of that rule is that nothing was checking
 * whether the two sides still said the same thing. Nothing did, for four milestones.
 *
 * What that cost:
 *
 *  - `NotebookParamType` gained `file` in the engine. The editor's list was written by
 *    hand and never grew. Uploads worked from an agent, from a webhook, and from a
 *    deployed page — and could not be declared by a person in the editor.
 *  - The list of renderers existed twice, once per package, with nothing comparing them.
 *  - The package allowlist existed only in the engine, so the editor could not refuse
 *    `pg` and the first news of a refusal was a failed run.
 *
 * The lists themselves now live in `@zaa-tool/shared`, which removes the drift rather
 * than detecting it. What remains detectable is the *judging*: the editor has to answer
 * the same question the engine will, early. So a corpus goes through both, and every
 * disagreement is a failure — including the ones where the editor is stricter, because an
 * editor that refuses what the engine allows is a feature nobody can use.
 *
 *   pnpm --filter @zaa-tool/engine test web-alignment
 */
import assert from "node:assert/strict";
import { PARAM_TYPES, OUTPUT_RENDERS } from "@zaa-tool/shared";
import { packageProblems } from "../src/core/notebook-packages.js";
import { PARAM_TYPES as enginePARAM_TYPES } from "../src/core/notebook-text.js";
import { OUTPUT_RENDERS as engineRENDERS } from "../src/core/notebook-outputs.js";
// The line the rule forbids anywhere else. A test whose whole purpose is to prove two
// packages agree is the one thing that has to touch both, and no bundler sees this file.
import { packageProblem } from "../../web/src/lib/notebook-packages.js";
import { RENDERS as webRENDERS } from "../../web/src/lib/notebook-outputs.js";

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

console.log("\none list, read by both");

check("the input types are the same list, not two lists that happen to match", () => {
  // Identity, not equality: two arrays with the same contents today is exactly the
  // arrangement that let `file` go missing, so the test is that there is one array.
  assert.equal(enginePARAM_TYPES, PARAM_TYPES);
});

check("the renderers are the same list on both sides", () => {
  assert.equal(engineRENDERS, OUTPUT_RENDERS);
  assert.equal(webRENDERS, OUTPUT_RENDERS);
});

check("every type the compiler accepts can be chosen, file included", () => {
  assert.ok(PARAM_TYPES.includes("file"), "`file` left the contract");
  assert.deepEqual([...PARAM_TYPES], ["string", "number", "boolean", "json", "file"]);
});

console.log("\ntwo judges, one answer");

/**
 * Shapes a person types into the packages field, and the shapes that are why the field
 * is validated at all. Each is judged by the engine and by the editor, and the two
 * verdicts must match — the wording may differ, the answer may not.
 */
const CORPUS: Array<{ runtime: "node" | "python"; entry: string }> = [
  // Plain names, both runtimes.
  { runtime: "python", entry: "pandas" },
  { runtime: "python", entry: "requests" },
  { runtime: "node", entry: "yaml" },
  { runtime: "node", entry: "uuid" },
  { runtime: "node", entry: "zod" },

  // Versions, in every marker `uv` reads.
  { runtime: "python", entry: "pandas==2.2.0" },
  { runtime: "python", entry: "python-dateutil>=2.8" },
  { runtime: "python", entry: "numpy~=1.26" },
  { runtime: "python", entry: "urllib3!=2.0.0" },
  { runtime: "python", entry: "httpx[http2]" },

  // The refusals that are the point of the allowlist.
  { runtime: "node", entry: "pg" },
  { runtime: "node", entry: "minio" },
  { runtime: "node", entry: "fs" },
  { runtime: "node", entry: "pandas" },

  // Ways of running something else, dressed as a requirement.
  { runtime: "python", entry: "pandas; rm -rf /" },
  { runtime: "python", entry: "--index-url http://example.com" },
  { runtime: "python", entry: "./local/package" },
  { runtime: "python", entry: "git+https://example.com/x.git" },
  { runtime: "python", entry: "pandas && curl example.com" },
  { runtime: "python", entry: "$(whoami)" },

  // Edges.
  { runtime: "python", entry: "" },
  { runtime: "python", entry: "   " },
  { runtime: "node", entry: "" },
  { runtime: "python", entry: "-pandas" },
  { runtime: "python", entry: "pandas " },
];

for (const { runtime, entry } of CORPUS) {
  check(`${runtime}: ${JSON.stringify(entry)} is judged the same by both`, () => {
    const engineRefuses = packageProblems(runtime, [entry]).length > 0;
    const editorRefuses = packageProblem(runtime, entry) !== null;

    assert.equal(
      editorRefuses,
      engineRefuses,
      editorRefuses
        ? "the editor refuses what the engine allows — a field nobody can use"
        : "the editor allows what the engine refuses — the failure arrives after deploying"
    );
  });
}

check("a refusal says which list, so the message is actionable on its own", () => {
  const problem = packageProblem("node", "pg");
  assert.ok(problem);
  assert.match(problem, /yaml/, problem);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

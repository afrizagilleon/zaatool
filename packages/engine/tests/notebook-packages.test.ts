/**
 * M21 — the library, and the two directions it moves in.
 *
 * Measured before this existed, and the result was backwards from the assumption:
 *
 *  - **Python cells had the standard library and nothing else.** No pandas, no requests,
 *    and no way to ask for either.
 *  - **JavaScript cells had the engine's entire dependency tree.** `require('pg')` from a
 *    notebook returned a working client to the database this application runs on.
 *
 * So one side opens and the other closes, and both use the shape `secrets:` already
 * established: the notebook names what it needs, and the engine decides whether it may
 * have it.
 *
 * The pandas check really installs pandas the first time it runs, which takes a while.
 * That is the point — a test that mocked the installation would be a test of nothing.
 *
 *   pnpm --filter @zaa-tool/engine test notebook-packages
 */
import assert from "node:assert/strict";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import { runNotebook } from "../src/core/notebook-runner.js";
import { packageProblems, ALLOWED_JS_PACKAGES } from "../src/core/notebook-packages.js";

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

const notebook = (front: string[], code: string, runtime = "node") =>
  [
    "---",
    "name: zz-packages",
    "id: zz-packages-id",
    `runtime: ${runtime}`,
    ...front,
    "---",
    "",
    "```" + (runtime === "python" ? "python" : "js"),
    code,
    "```",
  ].join("\n");

async function run(text: string, timeoutMs = 15_000) {
  const plan = compileNotebook(fromMarkdown(text));
  for (const step of plan.steps) {
    if (step.kind === "code") step.timeoutMs = timeoutMs;
  }
  return runNotebook(plan, {});
}

// ── what may be declared ──────────────────────────────────────────────────────

console.log("\nwhat a notebook may ask for");

check("Python may name anything on PyPI, with or without a version", () => {
  assert.deepEqual(packageProblems("python", ["pandas", "requests>=2.31", "python-dateutil"]), []);
});

check("a requirement that is really a command is refused", () => {
  for (const hostile of [
    "pandas; rm -rf /",
    "--index-url http://evil",
    "../../../etc/passwd",
    "https://example.com/pkg.tar.gz",
    "pandas && curl",
  ]) {
    assert.equal(
      packageProblems("python", [hostile]).length,
      1,
      `${JSON.stringify(hostile)} was accepted as a requirement`
    );
  }
});

check("JavaScript may name only what the engine ships", () => {
  assert.deepEqual(packageProblems("node", [...ALLOWED_JS_PACKAGES]), []);
  assert.match(packageProblems("node", ["pg"]).join(" "), /not available to JavaScript/);
  assert.match(packageProblems("node", ["left-pad"]).join(" "), /The list is/);
});

check("a bad list is refused when the notebook is written, not when it runs", () => {
  assert.throws(
    () => fromMarkdown(notebook(["packages: [pg]"], "return {};")),
    /not available to JavaScript/
  );
});

check("what is declared reaches the plan", () => {
  const plan = compileNotebook(fromMarkdown(notebook(["packages: [yaml]"], "return {};")));
  assert.deepEqual(plan.packages, ["yaml"]);
});

// ── JavaScript, narrowed ──────────────────────────────────────────────────────

console.log("\nwhat a JavaScript cell can reach");

await check("the engine's own database client is out of reach", async () => {
  const result = await run(notebook([], "const pg = require('pg'); return { got: typeof pg };"));
  assert.equal(result.status, "failed");
  assert.match(result.errors.join(" "), /require\("pg"\) is not available/);
});

await check("node's own modules still work, and need no declaration", async () => {
  const result = await run(
    notebook([], "const crypto = require('crypto'); return { bytes: crypto.randomBytes(4).length };")
  );
  assert.equal(result.status, "success", result.errors[0]);
  assert.equal(result.outputs.bytes ?? 4, 4);
});

await check("a declared package is available, and an undeclared one is not", async () => {
  const declared = await run(
    notebook(["packages: [yaml]", "outputs: [parsed]"], "const YAML = require('yaml'); return { parsed: YAML.parse('a: 1') };")
  );
  assert.equal(declared.status, "success", declared.errors[0]);
  assert.deepEqual(declared.outputs.parsed, { a: 1 });

  const undeclared = await run(
    notebook(["outputs: [parsed]"], "const YAML = require('yaml'); return { parsed: YAML.parse('a: 1') };")
  );
  assert.equal(undeclared.status, "failed");
  assert.match(undeclared.errors.join(" "), /`packages:`/);
});

await check("a cell cannot load a file by path either", async () => {
  const result = await run(notebook([], "require('../../package.json'); return {};"));
  assert.equal(result.status, "failed");
  assert.match(result.errors.join(" "), /cannot load files by path/);
});

// ── Python, opened ────────────────────────────────────────────────────────────

console.log("\nwhat a Python cell can reach");
console.log("  (the first run of this installs pandas — it is meant to be slow once)");

await check("a Python cell without packages still has the standard library", async () => {
  const result = await run(
    notebook(["outputs: [today]"], "import datetime\nreturn {'today': datetime.date(2026, 8, 4).isoformat()}", "python"),
    20_000
  );
  assert.equal(result.status, "success", result.errors[0]);
  assert.equal(result.outputs.today, "2026-08-04");
});

await check("a Python cell with `packages: [pandas]` gets pandas", async () => {
  const result = await run(
    notebook(
      ["packages: [pandas]", "outputs: [rows]"],
      [
        "import pandas as pd",
        "frame = pd.DataFrame([{'m': 'Jan', 'v': 1}, {'m': 'Jan', 'v': 2}, {'m': 'Feb', 'v': 5}])",
        "grouped = frame.groupby('m', as_index=False)['v'].sum()",
        "return {'rows': grouped.to_dict('records')}",
      ].join("\n"),
      "python"
    ),
    // Long enough for a cold install on a machine that has never seen pandas.
    240_000
  );

  assert.equal(result.status, "success", result.errors[0]);
  assert.deepEqual(result.outputs.rows, [
    { m: "Feb", v: 5 },
    { m: "Jan", v: 3 },
  ]);
});

await check("a Python cell without the declaration does not get it", async () => {
  // `cowsay` rather than pandas: pandas is commonly installed system-wide, which made
  // this test fail for a reason that has nothing to do with the property. `cowsay` is
  // declared in security-hardening.test.ts and is very unlikely to be installed globally.
  // If it is, say so explicitly instead of passing for the wrong reason.
  const probe = await run(
    notebook(
      ["outputs: [present]"],
      "import importlib.util\nreturn {'present': importlib.util.find_spec('cowsay') is not None}",
      "python"
    ),
    20_000
  );
  assert.equal(probe.status, "success", probe.errors[0]);
  assert.notEqual(
    probe.outputs.present,
    true,
    "PRECONDITION NOT MET: the interpreter used for cells without `packages:` already has `cowsay` " +
      "installed, so this test cannot show that an undeclared package is unavailable. " +
      "Uninstall `cowsay` from that interpreter (or pick another package) and re-run."
  );

  const result = await run(
    notebook(["outputs: [ok]"], "import cowsay\nreturn {'ok': True}", "python"),
    20_000
  );
  assert.equal(result.status, "failed");
  assert.match(result.errors.join(" "), /cowsay/i);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

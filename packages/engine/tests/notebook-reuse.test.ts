/**
 * M5b — the reuse boundary.
 *
 * Runs against the real runners (a worker thread for JS, a Python child process) with
 * a stub caller standing in for the engine, so the RPC bridge itself is under test and
 * not a mock of it. The service-level checks — cycles, depth, contracts — drive the
 * real notebook runner.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-reuse.test.ts
 */
import assert from "node:assert/strict";
import { runJsNode } from "../src/core/js-runner.js";
import { runPythonNode } from "../src/core/python-runner.js";
import { runNotebook } from "../src/core/notebook-runner.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import { bindInputs, selectOutputs, ContractError } from "../src/core/notebook-contract.js";
import type { NotebookCaller } from "../src/core/notebook-call.js";
import type { NotebookJson } from "@zaa-tool/shared";

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

const doc = (over: Partial<NotebookJson>): NotebookJson => ({
  version: "1",
  id: "nb-test",
  name: "Test",
  runtime: "node",
  steps: [],
  ...over,
});

const cell = (id: string, code: string) => ({ id, kind: "cell" as const, code });

// ── contract ──────────────────────────────────────────────────────────────────

console.log("\ncontract");

await check("required input missing is refused before anything runs", () => {
  assert.throws(
    () => bindInputs([{ name: "userId", type: "number", required: true }], {}),
    (err: unknown) => err instanceof ContractError && err.issues[0].includes("required")
  );
});

await check("a default stands in for an omitted value", () => {
  const bound = bindInputs([{ name: "limit", type: "number", default: 10 }], {});
  assert.deepEqual(bound, { limit: 10 });
});

await check("numeric strings coerce, words do not", () => {
  assert.deepEqual(bindInputs([{ name: "n", type: "number" }], { n: "42" }), { n: 42 });
  assert.throws(() => bindInputs([{ name: "n", type: "number" }], { n: "forty" }), ContractError);
});

await check("undeclared arguments cannot reach scope", () => {
  const bound = bindInputs([{ name: "a", type: "string" }], { a: "x", sneaky: "y" });
  assert.deepEqual(bound, { a: "x" });
});

await check("a declared output never written comes back as null", () => {
  assert.deepEqual(selectOutputs(["total", "missing"], { total: 7, internal: 1 }), {
    total: 7,
    missing: null,
  });
});

await check("outputs are the whole of what a caller sees", () => {
  assert.deepEqual(selectOutputs(["total"], { total: 7, secretIntermediate: "leak" }), { total: 7 });
});

await check("a duplicate input is a compile error, not a last-one-wins", () => {
  assert.throws(() =>
    compileNotebook(
      doc({
        inputs: [
          { name: "x", type: "string" },
          { name: "x", type: "number" },
        ],
      })
    )
  );
});

// ── the JS bridge ─────────────────────────────────────────────────────────────

console.log("\njavascript worker → engine");

await check("notebooks.run reaches the engine and returns its outputs", async () => {
  const calls: unknown[] = [];
  const caller: NotebookCaller = async (request) => {
    calls.push(request);
    return { doubled: (request.input?.n as number) * 2 };
  };

  const result = await runJsNode(
    `const r = await notebooks.run('doubler', { n: 21 }); return { got: r.doubled };`,
    {},
    10_000,
    undefined,
    {},
    [],
    caller
  );

  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { got: 42 });
  assert.deepEqual(calls, [{ notebook: "doubler", input: { n: 21 } }]);
});

await check("a callee's failure surfaces as a catchable error in the caller", async () => {
  const caller: NotebookCaller = async () => {
    throw new Error("callee exploded");
  };

  const result = await runJsNode(
    `try { await notebooks.run('x'); return { caught: false }; }
     catch (err) { return { caught: true, message: err.message }; }`,
    {},
    10_000,
    undefined,
    {},
    [],
    caller
  );

  assert.deepEqual(result.output, { caught: true, message: "callee exploded" });
});

await check("without a caller the cell is told so, not left hanging", async () => {
  const result = await runJsNode(
    `try { await notebooks.run('x'); return { ok: true }; }
     catch (err) { return { ok: false, message: err.message }; }`,
    {},
    5_000
  );
  assert.equal((result.output as any)?.ok, false);
  assert.match((result.output as any)?.message, /not available/);
});

await check("two calls in one cell resolve to their own results", async () => {
  const caller: NotebookCaller = async (request) => ({ echo: request.notebook });
  const result = await runJsNode(
    `const a = await notebooks.run('first');
     const b = await notebooks.run('second');
     return { a: a.echo, b: b.echo };`,
    {},
    10_000,
    undefined,
    {},
    [],
    caller
  );
  assert.deepEqual(result.output, { a: "first", b: "second" });
});

await check("the cell clock is paused while a callee runs", async () => {
  // Cell limit 1500ms, callee takes 2500ms: without pausing this times out.
  const caller: NotebookCaller = async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return { slow: true };
  };

  const result = await runJsNode(
    `const r = await notebooks.run('slow'); return { slow: r.slow };`,
    {},
    1_500,
    undefined,
    {},
    [],
    caller
  );

  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { slow: true });
});

await check("the clock resumes after the call, so a hang is still caught", async () => {
  const caller: NotebookCaller = async () => ({ ok: true });
  const result = await runJsNode(
    `await notebooks.run('x'); await new Promise(() => {}); return {};`,
    {},
    1_200,
    undefined,
    {},
    [],
    caller
  );
  assert.match(result.error ?? "", /Timeout/);
});

// ── the Python bridge ─────────────────────────────────────────────────────────

console.log("\npython child → engine");

await check("notebooks.run works the same from Python", async () => {
  const caller: NotebookCaller = async (request) => ({
    doubled: (request.input?.n as number) * 2,
  });

  const result = await runPythonNode(
    `r = notebooks.run('doubler', {"n": 21})\nreturn {"got": r["doubled"]}`,
    {},
    15_000,
    undefined,
    {},
    [],
    caller
  );

  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { got: 42 });
});

await check("print() is a log line, not corruption of the result", async () => {
  const logs: string[] = [];
  const result = await runPythonNode(
    `print("hello from python")\nreturn {"value": 1}`,
    {},
    15_000,
    (_level, msg) => logs.push(msg)
  );

  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { value: 1 });
  assert.ok(logs.includes("hello from python"), `logs were ${JSON.stringify(logs)}`);
});

await check("a Python exception is reported as an error, not a parse failure", async () => {
  const result = await runPythonNode(`raise ValueError("boom")`, {}, 15_000);
  assert.match(result.error ?? "", /ValueError: boom/);
});

// ── nesting rules, through the real runner ────────────────────────────────────

console.log("\nnesting");

/** A miniature of what the execution service does, without the database. */
function makeCaller(
  library: Record<string, NotebookJson>,
  stack: string[] = ["root"],
  names: string[] = ["root"]
): NotebookCaller {
  return async (request) => {
    const found = library[request.notebook];
    if (!found) throw new Error(`Notebook "${request.notebook}" not found`);

    const chain = [...names, found.name];
    if (stack.includes(found.id)) throw new Error(`Notebook call cycle: ${chain.join(" → ")}`);
    if (stack.length >= 5) throw new Error(`Notebook calls nested more than 5 deep`);

    const plan = compileNotebook(found);
    const input = bindInputs(plan.inputs, request.input);
    const result = await runNotebook(plan, {
      input,
      call: makeCaller(library, [...stack, found.id], chain),
    });

    if (result.status === "failed") throw new Error(`${found.name}: ${result.errors[0]}`);
    return result.outputs;
  };
}

await check("one notebook calls another and gets its declared outputs", async () => {
  const library: Record<string, NotebookJson> = {
    adder: doc({
      id: "adder",
      name: "adder",
      inputs: [
        { name: "a", type: "number", required: true },
        { name: "b", type: "number", required: true },
      ],
      outputs: ["sum"],
      steps: [cell("c1", "return { sum: inputs.a + inputs.b, workings: 'private' };")],
    }),
  };

  const caller = makeCaller(library);
  const result = await runJsNode(
    `const r = await notebooks.run('adder', { a: 2, b: 3 }); return { sum: r.sum, leaked: r.workings ?? null };`,
    {},
    20_000,
    undefined,
    {},
    [],
    caller
  );

  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.output, { sum: 5, leaked: null });
});

await check("a cycle is refused with the chain that caused it", async () => {
  const library: Record<string, NotebookJson> = {
    ping: doc({
      id: "ping",
      name: "ping",
      outputs: ["done"],
      steps: [cell("p1", "const r = await notebooks.run('pong'); return { done: r.done };")],
    }),
    pong: doc({
      id: "pong",
      name: "pong",
      outputs: ["done"],
      steps: [cell("q1", "const r = await notebooks.run('ping'); return { done: r.done };")],
    }),
  };

  // The root of the stack is "ping" itself, as it would be for a real run.
  const caller = makeCaller(library, ["ping"], ["ping"]);
  const result = await runJsNode(
    `try { await notebooks.run('pong'); return { cycled: false }; }
     catch (err) { return { cycled: true, message: err.message }; }`,
    {},
    20_000,
    undefined,
    {},
    [],
    caller
  );

  assert.equal((result.output as any)?.cycled, true);
  assert.match((result.output as any)?.message, /cycle: ping → pong → ping/);
});

await check("a missing required argument fails the call, not the callee's first cell", async () => {
  const library: Record<string, NotebookJson> = {
    needs: doc({
      id: "needs",
      name: "needs",
      inputs: [{ name: "who", type: "string", required: true }],
      outputs: ["greeting"],
      steps: [cell("n1", "return { greeting: 'hi ' + inputs.who };")],
    }),
  };

  const caller = makeCaller(library);
  const result = await runJsNode(
    `try { await notebooks.run('needs', {}); return { ok: true }; }
     catch (err) { return { ok: false, message: err.message }; }`,
    {},
    20_000,
    undefined,
    {},
    [],
    caller
  );

  assert.equal((result.output as any)?.ok, false);
  assert.match((result.output as any)?.message, /"who" is required/);
});

await check("depth is bounded", async () => {
  const library: Record<string, NotebookJson> = {};
  // Six links, each calling the next: deeper than the limit of five.
  for (let index = 1; index <= 6; index += 1) {
    library[`n${index}`] = doc({
      id: `n${index}`,
      name: `n${index}`,
      outputs: ["depth"],
      steps: [
        cell(
          `c${index}`,
          index === 6
            ? "return { depth: 6 };"
            : `const r = await notebooks.run('n${index + 1}'); return { depth: r.depth };`
        ),
      ],
    });
  }

  const caller = makeCaller(library, [], []);
  const result = await runJsNode(
    `try { const r = await notebooks.run('n1'); return { ok: true, depth: r.depth }; }
     catch (err) { return { ok: false, message: err.message }; }`,
    {},
    60_000,
    undefined,
    {},
    [],
    caller
  );

  assert.equal((result.output as any)?.ok, false);
  assert.match((result.output as any)?.message, /nested more than 5 deep/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

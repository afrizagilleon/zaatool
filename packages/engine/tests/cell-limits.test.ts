import assert from "node:assert/strict";
import { JS_RUNTIME_RESERVE_MB, limitedCommand, prlimitArgs } from "../src/core/cell-limits.js";
import { cellLimits } from "../src/config.js";

/**
 * S-03 / S-05: the shape of the command a cell is started with. That the kernel then
 * enforces the limits needs Linux and is shown against the image, not here.
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

const limits = { memoryMb: 512, processes: 1024, fileMb: 100 };
const MB = 1024 * 1024;

await check("not applied without a sandbox uid: the command is returned untouched", () => {
  const command = { bin: "python3", args: ["-c", "x"] };
  assert.deepEqual(limitedCommand(command, "python", limits, false), command);
  assert.deepEqual(limitedCommand(command, "js", limits, false), command);
});

await check("python: memory, processes, file size and core dump are all set, before the command", () => {
  const out = limitedCommand({ bin: "python3", args: ["-c", "x"] }, "python", limits, true, "/usr/bin/prlimit");
  assert.equal(out.bin, "/usr/bin/prlimit");
  assert.deepEqual(out.args.slice(0, 5), [`--data=${512 * MB}`, "--nproc=1024", `--fsize=${100 * MB}`, "--core=0", "--"]);
  assert.equal(out.args[5], "/usr/bin/env");
  assert.ok(out.args.includes("OPENBLAS_NUM_THREADS=4"));
  assert.deepEqual(out.args.slice(-3), ["python3", "-c", "x"]);
});

await check("js: the memory limit leaves room for what a bare Node reserves", () => {
  assert.equal(prlimitArgs(limits, "js")[0], `--data=${(512 + JS_RUNTIME_RESERVE_MB) * MB}`);
  const out = limitedCommand({ bin: "/usr/local/bin/node", args: ["--permission", "cell.mjs"] }, "js", limits, true);
  assert.deepEqual(out.args.slice(-3), ["/usr/local/bin/node", "--permission", "cell.mjs"]);
  assert.ok(!out.args.includes("/usr/bin/env"));
});

await check("limits come from the environment with defaults, and bad values fall back", () => {
  const saved = { ...process.env };
  try {
    delete process.env.MAX_CELL_PROCESSES;
    delete process.env.MAX_CELL_FILE_MB;
    delete process.env.MAX_CELL_MEMORY_MB;
    assert.deepEqual(cellLimits(), { memoryMb: 512, processes: 256, fileMb: 1024 });
    process.env.MAX_CELL_PROCESSES = "300";
    process.env.MAX_CELL_FILE_MB = "-5";
    process.env.MAX_CELL_MEMORY_MB = "";
    assert.deepEqual(cellLimits(), { memoryMb: 512, processes: 300, fileMb: 1024 });
  } finally {
    process.env = saved;
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

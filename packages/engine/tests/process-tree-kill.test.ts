/**
 * A Python timeout must take down the whole process tree, not just the direct child.
 * Before: `proc.kill()` killed only `uv` (or only the interpreter), and what it had
 * started kept running, an infinite loop burning CPU forever.
 *
 *   pnpm --filter @zaa-tool/engine test process-tree-kill
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fromMarkdown } from "../src/core/notebook-text.js";
import { compileNotebook } from "../src/core/notebook-compiler.js";
import { runNotebook } from "../src/core/notebook-runner.js";
import { taskkillPath } from "../src/core/kill-tree.js";

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-k10-"));
const spawned: number[] = [];

function alive(pid: number): boolean {
  if (process.platform === "win32") {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" });
    return out.split(/\r?\n/).some((line) => new RegExp(`\\s${pid}\\s`).test(line));
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(probe: () => T | undefined, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v !== undefined || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function timeoutScenario(label: string, front: string[], timeoutMs: number) {
  const marker = path.join(dir, `${label}.pid`).replace(/\\/g, "/");
  const code = [
    "import subprocess, sys",
    `subprocess.Popen([sys.executable, "-c", "import time; open(r'${marker}','w').write(str(__import__('os').getpid())); time.sleep(120)"])`,
    "while True:",
    "    pass",
  ].join("\n");
  const text = [
    "---",
    `name: zz-k10-${label}`,
    `id: zz-k10-${label}-id`,
    "runtime: python",
    ...front,
    "---",
    "",
    "```python",
    code,
    "```",
  ].join("\n");
  const plan = compileNotebook(fromMarkdown(text));
  for (const step of plan.steps) if (step.kind === "code") step.timeoutMs = timeoutMs;

  const result = await runNotebook(plan, {});
  const read = (): number | undefined => {
    if (!fs.existsSync(marker)) return undefined;
    const t = fs.readFileSync(marker, "utf8").trim();
    return t ? Number(t) : undefined;
  };
  const pid = await waitFor(read, 5_000);
  assert.ok(pid, "the grandchild never wrote its pid, so the scenario did not run");
  spawned.push(pid);
  return { result, pid };
}

console.log("\nprocess tree kill");

await check("a timed-out Python cell does not leave a subprocess it spawned running", async () => {
  const { result, pid } = await timeoutScenario("plain", [], 3_000);
  assert.match(JSON.stringify(result), /Timeout/);
  const gone = await waitFor(() => (alive(pid) ? undefined : true), 5_000);
  assert.equal(gone, true, `grandchild ${pid} is still running`);
});

await check("with packages (uv path) the python child and its subprocess are gone too", async () => {
  const { result, pid } = await timeoutScenario("uv", ["packages: [six]"], 20_000);
  assert.match(JSON.stringify(result), /Timeout/);
  const gone = await waitFor(() => (alive(pid) ? undefined : true), 5_000);
  assert.equal(gone, true, `grandchild ${pid} is still running`);
});

// Whatever a failing assertion left behind must not outlive the test.
for (const pid of spawned) {
  if (!alive(pid)) continue;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    else process.kill(pid, "SIGKILL");
  } catch {
    // gone
  }
}
fs.rmSync(dir, { recursive: true, force: true });

await check("taskkill is run by its full path, never looked up in PATH", () => {
  assert.equal(taskkillPath("C:\\Windows"), "C:\\Windows\\System32\\taskkill.exe");
  assert.equal(taskkillPath("D:\\Win"), "D:\\Win\\System32\\taskkill.exe");
  // Missing or relative SystemRoot: the standard location, not a bare name for PATH to resolve.
  for (const bad of ["", "Windows", ".\\evil"]) {
    assert.equal(taskkillPath(bad), "C:\\Windows\\System32\\taskkill.exe", JSON.stringify(bad));
  }
  // No argument: Windows' own SystemRoot when it is set, the standard location otherwise.
  assert.match(taskkillPath(), /^[A-Za-z]:\\.*\\System32\\taskkill\.exe$/);
  if (process.platform === "win32") {
    assert.ok(fs.existsSync(taskkillPath()), "the resolved taskkill.exe exists on this machine");
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

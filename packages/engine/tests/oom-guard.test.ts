/**
 * S-17: a cell is made the first thing the kernel's OOM killer picks, by the engine writing 1000
 * to the cell's `/proc/<pid>/oom_score_adj` after the spawn and before it is handed any work.
 * Here the write is injected; that the kernel then holds the value against the cell, and that
 * the engine survives an OOM, is shown on Linux in tests/sandbox-linux-root.test.ts.
 *
 *   pnpm --filter @zaa-tool/engine test oom-guard
 */
import assert from "node:assert/strict";
import { CELL_OOM_SCORE_ADJ, lockOomScore, oomGuardWarning } from "../src/core/oom-guard.js";

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

await check("writes 1000 to the cell's own oom_score_adj on Linux", () => {
  const writes: Array<[string, string]> = [];
  assert.equal(lockOomScore(4242, "linux", (file, value) => void writes.push([file, value])), undefined);
  assert.deepEqual(writes, [["/proc/4242/oom_score_adj", "1000"]]);
  assert.equal(CELL_OOM_SCORE_ADJ, 1000);
});

await check("a failed write is reported, not thrown (a run without the guard is better than none)", () => {
  const problem = lockOomScore(7, "linux", () => {
    throw new Error("EACCES: permission denied");
  });
  assert.match(problem ?? "", /oom_score_adj=1000 on cell process 7.*EACCES/);
});

await check("not Linux, or no pid (the spawn failed): nothing is written", () => {
  const never = () => assert.fail("must not write");
  assert.equal(lockOomScore(1, "win32", never), undefined);
  assert.equal(lockOomScore(1, "darwin", never), undefined);
  assert.equal(lockOomScore(undefined, "linux", never), undefined);
});

await check("the start-up warning: Linux without CAP_SYS_RESOURCE (bit 24) is told, with it or elsewhere is not", () => {
  const status = (mask: string) => () => `Name:\tnode\nCapEff:\t${mask}\nCapBnd:\t${mask}\n`;
  // Docker's default capability set (no SYS_RESOURCE) and the same plus bit 24.
  assert.match(oomGuardWarning("linux", status("00000000a80425fb")) ?? "", /CAP_SYS_RESOURCE.*cap_add: \[SYS_RESOURCE\]/);
  assert.equal(oomGuardWarning("linux", status("00000000a90425fb")), undefined);
  assert.equal(oomGuardWarning("linux", status("000001ffffffffff")), undefined, "a full set has it");
  assert.equal(oomGuardWarning("win32", status("0")), undefined);
  assert.equal(oomGuardWarning("linux", () => { throw new Error("no /proc"); }), undefined, "unreadable: say nothing");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

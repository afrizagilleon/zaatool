/**
 * M17 — the editor can build every structure the compiler accepts.
 *
 * The gap this closes is a specific one. Nesting a parallel group inside a lane always
 * worked: the document allows it, the compiler accepts it, and it really does run
 * concurrently. But the editor offered no way to make one, and drew the ones agents
 * wrote flat — so a structure that existed looked forbidden.
 *
 * These checks are on the pure tree helpers rather than on React, because that is where
 * nesting bugs live. Two invariants the compiler depends on are asserted directly: a
 * lane is never empty, and a group never has zero lanes.
 *
 *   pnpm --filter @zaa-tool/web exec tsx tests/notebook-tree.test.ts
 */
import assert from "node:assert/strict";
import type { NotebookStep, ParallelStep } from "@zaa-tool/shared";
import * as tree from "../src/lib/notebook-tree.js";

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

/** Depth of the deepest parallel group, counting the outermost as 1. */
function depthOf(steps: NotebookStep[]): number {
  let deepest = 0;
  for (const step of steps) {
    if (step.kind !== "parallel") continue;
    for (const lane of step.lanes) {
      deepest = Math.max(deepest, 1 + depthOf(lane.steps));
    }
  }
  return deepest;
}

function groupsIn(steps: NotebookStep[]): ParallelStep[] {
  return steps.flatMap((step) =>
    step.kind === "parallel" ? [step, ...step.lanes.flatMap((lane) => groupsIn(lane.steps))] : []
  );
}

console.log("\nnesting");

check("a group can be appended to a lane", () => {
  const group = tree.newParallelGroup();
  const steps: NotebookStep[] = [group];

  const next = tree.appendToLane(steps, group.id, group.lanes[0].id, tree.newParallelGroup());

  assert.equal(depthOf(next), 2);
  assert.equal(groupsIn(next).length, 2);
});

check("nesting three deep still resolves", () => {
  const outer = tree.newParallelGroup();
  let steps: NotebookStep[] = [outer];

  const middle = tree.newParallelGroup();
  steps = tree.appendToLane(steps, outer.id, outer.lanes[0].id, middle);

  const inner = tree.newParallelGroup();
  steps = tree.appendToLane(steps, middle.id, middle.lanes[0].id, inner);

  assert.equal(depthOf(steps), 3);
});

check("appending to a lane leaves the sibling lane alone", () => {
  const group = tree.newParallelGroup();
  const steps = tree.appendToLane(group.lanes.length ? [group] : [], group.id, group.lanes[0].id, tree.newParallelGroup());

  const [updated] = groupsIn(steps);
  assert.equal(depthOf(updated.lanes[0].steps), 1, "lane 1 gained the group");
  assert.equal(depthOf(updated.lanes[1].steps), 0, "lane 2 was untouched");
});

check("a cell added to a nested lane lands there and nowhere else", () => {
  const outer = tree.newParallelGroup();
  const inner = tree.newParallelGroup();
  let steps: NotebookStep[] = tree.appendToLane([outer], outer.id, outer.lanes[0].id, inner);

  const cell = tree.newCell();
  steps = tree.appendToLane(steps, inner.id, inner.lanes[1].id, cell);

  assert.equal(tree.allCells(steps).filter((c) => c.id === cell.id).length, 1);
  const [, nested] = groupsIn(steps);
  assert.equal(nested.lanes[1].steps.length, 2, "the lane it was added to");
  assert.equal(nested.lanes[0].steps.length, 1, "the lane it was not");
});

console.log("\ninvariants the compiler depends on");

check("a new group always has two non-empty lanes", () => {
  const group = tree.newParallelGroup();
  assert.equal(group.lanes.length, 2);
  for (const lane of group.lanes) assert.ok(lane.steps.length > 0, "lane is not empty");
});

check("removing the last lane dissolves the group rather than leaving it invalid", () => {
  const group = tree.newParallelGroup(1);
  const steps = tree.removeLane([group], group.id, group.lanes[0].id);
  assert.equal(groupsIn(steps).length, 0);
});

check("removing a nested group's last lane dissolves only that group", () => {
  const outer = tree.newParallelGroup();
  const inner = tree.newParallelGroup(1);
  let steps: NotebookStep[] = tree.appendToLane([outer], outer.id, outer.lanes[0].id, inner);
  assert.equal(depthOf(steps), 2);

  steps = tree.removeLane(steps, inner.id, inner.lanes[0].id);

  assert.equal(depthOf(steps), 1, "the outer group survives");
  assert.equal(groupsIn(steps)[0].lanes.length, 2);
});

check("removing every step leaves one cell, never an empty notebook", () => {
  const cell = tree.newCell();
  assert.equal(tree.removeStep([cell], cell.id).length, 1);
});

console.log("\nreading the tree through nesting");

check("allCells finds cells at every depth, in execution order", () => {
  const outer = tree.newParallelGroup();
  const inner = tree.newParallelGroup();
  const steps = tree.appendToLane([outer], outer.id, outer.lanes[0].id, inner);

  // outer lane 1: its own cell + inner's two lanes; outer lane 2: its own cell.
  assert.equal(tree.allCells(steps).length, 4);
});

check("cellsAfter crosses out of a nested lane but never into a sibling lane", () => {
  const outer = tree.newParallelGroup();
  const inner = tree.newParallelGroup();
  const tail = tree.newCell();

  let steps: NotebookStep[] = [outer, tail];
  steps = tree.appendToLane(steps, outer.id, outer.lanes[0].id, inner);

  const deepCell = inner.lanes[0].steps[0].id;
  const after = tree.cellsAfter(steps, deepCell);

  assert.ok(after.includes(tail.id), "the step after the whole group depends on it");
  assert.ok(
    !after.includes(inner.lanes[1].steps[0].id),
    "a sibling lane reads the scope as it stood at the fork, so it does not depend on this"
  );
  assert.ok(
    !after.includes(outer.lanes[1].steps[0].id),
    "nor does a sibling lane of the outer group"
  );
});

check("stepLabel names a cell by the lanes containing it", () => {
  const outer = tree.newParallelGroup();
  const inner = tree.newParallelGroup();
  const steps = tree.appendToLane([outer], outer.id, outer.lanes[0].id, inner);

  const label = tree.stepLabel(steps, inner.lanes[1].steps[0].id);
  assert.equal(label, "Lane 1 · Lane 2 · Cell 1");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

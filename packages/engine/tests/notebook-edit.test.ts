import { test } from "node:test";
import assert from "node:assert/strict";
import type { NotebookJson, ParallelStep } from "@zaa-tool/shared";
import { applyCellEdit, CellEditError } from "../src/core/notebook-edit.js";

function sampleParallelNotebook(): NotebookJson {
  return {
    version: "1.0",
    id: "zz-notebook-test-1",
    name: "zz-notebook-test-1",
    runtime: "node",
    steps: [
      {
        id: "parallel-1",
        kind: "parallel",
        lanes: [
          {
            id: "lane-1",
            label: "Lane A",
            steps: [
              { id: "cell-1a", kind: "cell", code: "return { a: 1 };" },
            ],
          },
          {
            id: "lane-2",
            label: "Lane B",
            steps: [],
          },
        ],
      },
    ],
  };
}

test("T-01: add_lane adds a new lane to a parallel group", () => {
  const doc = sampleParallelNotebook();
  const edited = applyCellEdit(doc, {
    action: "add_lane",
    cell: "parallel-1",
    label: "Lane C",
  });

  const parallel = edited.steps[0] as ParallelStep;
  assert.equal(parallel.lanes.length, 3);
  assert.equal(parallel.lanes[0].id, "lane-1");
  assert.equal(parallel.lanes[1].id, "lane-2");
  assert.equal(parallel.lanes[2].label, "Lane C");
  assert.equal(parallel.lanes[2].steps.length, 0);
});

test("T-01: remove_lane removes empty lane without force", () => {
  const doc = sampleParallelNotebook();
  const edited = applyCellEdit(doc, {
    action: "remove_lane",
    cell: "parallel-1/lane:2",
  });

  const parallel = edited.steps[0] as ParallelStep;
  assert.equal(parallel.lanes.length, 1);
  assert.equal(parallel.lanes[0].id, "lane-1");
});

test("T-01: remove_lane refuses non-empty lane without force", () => {
  const doc = sampleParallelNotebook();
  assert.throws(
    () =>
      applyCellEdit(doc, {
        action: "remove_lane",
        cell: "parallel-1/lane:1",
      }),
    (err: unknown) => {
      assert.ok(err instanceof CellEditError);
      assert.match(err.message, /Lane is not empty/i);
      return true;
    }
  );
});

test("T-01: remove_lane removes non-empty lane with force: true", () => {
  const doc = sampleParallelNotebook();
  const edited = applyCellEdit(doc, {
    action: "remove_lane",
    cell: "parallel-1/lane:1",
    force: true,
  });

  const parallel = edited.steps[0] as ParallelStep;
  assert.equal(parallel.lanes.length, 1);
  assert.equal(parallel.lanes[0].id, "lane-2");
});

test("T-02: insert_before inserts cell into empty lane", () => {
  const doc = sampleParallelNotebook();
  const edited = applyCellEdit(doc, {
    action: "insert_before",
    cell: "parallel-1/lane:2",
    code: "return { b: 2 };",
  });

  const parallel = edited.steps[0] as ParallelStep;
  assert.equal(parallel.lanes[1].steps.length, 1);
  assert.equal(parallel.lanes[1].steps[0].kind, "cell");
  assert.equal((parallel.lanes[1].steps[0] as { code: string }).code, "return { b: 2 };");
});

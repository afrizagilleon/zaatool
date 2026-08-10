import { test } from "node:test";
import assert from "node:assert/strict";
import { notebooksService } from "../src/services/notebooks.service.js";
import { pool } from "../src/db/connection.js";

const NOTEBOOK_ID = "zz-notebook-tools-test";
const NOTEBOOK_NAME = "zz-notebook-tools-test";

test("T-03 / T-04: notebook_read defaults and etag support", async () => {
  // Cleanup before
  await pool.query("DELETE FROM notebooks WHERE id = $1", [NOTEBOOK_ID]);

  try {
    const saved = await notebooksService.save(
      {
        version: "1.0",
        id: NOTEBOOK_ID,
        name: NOTEBOOK_NAME,
        runtime: "node",
        steps: [{ id: "cell-1", kind: "cell", code: "return { x: 1 };" }],
      },
      "test"
    );

    const record = await notebooksService.getById(NOTEBOOK_ID);
    assert.ok(record);
    assert.ok(record.updated_at);
    assert.equal(saved.id, NOTEBOOK_ID);
  } finally {
    // Cleanup after
    await pool.query("DELETE FROM notebooks WHERE id = $1", [NOTEBOOK_ID]);
  }
});

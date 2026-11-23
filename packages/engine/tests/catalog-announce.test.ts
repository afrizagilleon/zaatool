/**
 * FX5 — a change to the notebooks says so, whoever made it.
 *
 * The announcement existed before this milestone and was wired the wrong way round: each
 * caller was expected to remember it. Deploy remembered, undeploy remembered, delete
 * remembered — and every one of the four save paths forgot, which is the change that
 * happens most. So a notebook saved in the editor reached a list on another screen only
 * when somebody pressed reload, and an agent holding an MCP session was told its tools had
 * changed for a deploy but not for the edit that changed what the tool does.
 *
 * The fix is not "remember in more places". Announcing is now part of writing, inside
 * `notebooksService`, so a fifth way to save a notebook cannot be added silently. This
 * file is what holds that: it goes through the service, which is what every caller —
 * controller, MCP tool, import — actually reaches.
 *
 * Against the real database, because the claim includes *when* a notice is not sent:
 * undeploying something that was never deployed changes no row and must therefore say
 * nothing, and that is a fact about `rowCount`, not about my intentions.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/catalog-announce.test.ts
 */
import assert from "node:assert/strict";
import { pool } from "../src/db/connection.js";
import { initDb } from "../src/db/initializer.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { withContext } from "../src/core/request-context.js";
import { onCatalogChanged, type CatalogChangeNotice } from "../src/core/catalog-events.js";
import type { NotebookJson } from "@zaa-tool/shared";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => Promise<void>): Promise<void> {
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

const PREFIX = "zz-fx5-";
const made: string[] = [];

/** Collects notices for the duration of one action, then stops listening. */
async function noticesDuring(act: () => Promise<void>): Promise<CatalogChangeNotice[]> {
  const seen: CatalogChangeNotice[] = [];
  const stop = onCatalogChanged((notice) => seen.push(notice));
  try {
    await act();
  } finally {
    stop();
  }
  return seen;
}

async function save(name: string, over: Partial<NotebookJson> = {}): Promise<string> {
  const saved = await notebooksService.save({
    version: "1.0",
    id: "",
    name: PREFIX + name,
    runtime: "node",
    steps: [],
    ...over,
  } as NotebookJson, undefined, undefined, { expectedRevision: "any" });
  if (!made.includes(saved.id)) made.push(saved.id);
  return saved.id;
}

async function main(): Promise<void> {
  await initDb();

  console.log("\nwriting a notebook announces it");

  let firstId = "";
  await check("saving a new notebook says so, and names it", async () => {
    const seen = await noticesDuring(async () => {
      firstId = await save("announce");
    });
    assert.deepEqual(seen, [{ change: "saved", notebookId: firstId, revision: 1 }]);
  });

  await check("saving an existing one says so too", async () => {
    // The gap that mattered most. An edit is the commonest change there is, and it was
    // the one nothing announced.
    const seen = await noticesDuring(async () => {
      await save("announce", { id: firstId, steps: [] });
    });
    // The revision is what lets an open editor tell this save from its own.
    assert.deepEqual(seen, [{ change: "saved", notebookId: firstId, revision: 2 }]);
  });

  await check("a save names who made it, as a kind and a name and nothing more", async () => {
    const seen = await noticesDuring(async () => {
      await withContext(
        { actor: { type: "agent", tokenId: "tok-secret-id", label: "claude code", userId: "u1" } },
        () => save("announce", { id: firstId, steps: [] })
      );
    });
    assert.deepEqual(seen[0].by, { kind: "agent", name: "claude code" });
    assert.ok(!JSON.stringify(seen[0]).includes("tok-secret-id"), "the token id reached the notice");
  });

  console.log("\nand so does every other way a notebook moves");

  await check("deploying is its own kind of change", async () => {
    const seen = await noticesDuring(async () => {
      await notebooksService.deploy(firstId, "zz-fx5");
    });
    assert.deepEqual(seen, [{ change: "deployed", notebookId: firstId }]);
  });

  await check("undeploying is distinguishable from deploying", async () => {
    const seen = await noticesDuring(async () => {
      await notebooksService.undeploy(firstId);
    });
    // `audience` is who may be told, asked before the change took the page away; it never
    // reaches a client (the socket builds its event field by field). A page open to
    // everybody has no list: `null`.
    assert.deepEqual(seen, [{ change: "undeployed", notebookId: firstId, audience: null }]);
  });

  await check("undeploying something that was not deployed says nothing", async () => {
    // No row changed, so no screen has anything to refetch. A notice here would be every
    // open list re-reading the catalogue to discover it is identical.
    const seen = await noticesDuring(async () => {
      await notebooksService.undeploy(firstId);
    });
    assert.deepEqual(seen, []);
  });

  await check("deleting says so, which is what removes it from an open list", async () => {
    const doomedId = await save("doomed");
    const seen = await noticesDuring(async () => {
      await notebooksService.delete(doomedId);
    });
    // Nobody owns it and it was never an app, so nobody in particular is told.
    assert.deepEqual(seen, [{ change: "deleted", notebookId: doomedId, audience: [] }]);
  });

  console.log("\nwhat the notice contains");

  await check("identity and nothing else", async () => {
    // It travels on a channel that is not scoped to anything the client asked for. The
    // shape is the guard: there is nowhere to put a document even by accident.
    const seen = await noticesDuring(async () => {
      await save("shape", { id: firstId });
    });
    assert.deepEqual(Object.keys(seen[0]).sort(), ["change", "notebookId", "revision"]);
  });
}

try {
  await main();
} finally {
  // Fixtures are hidden, never left behind — these are made per run and have no evidence
  // value once the run has reported.
  for (const id of made) {
    await notebooksService.delete(id).catch(() => undefined);
  }
  await pool.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

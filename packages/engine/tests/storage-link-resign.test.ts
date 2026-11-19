import assert from "node:assert/strict";
import { initDb } from "../src/db/initializer.js";
import { pool } from "../src/db/connection.js";
import { signStorageLink, storageLinkValid, resignStorageLinks } from "../src/core/storage-links.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";

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

await initDb();

console.log("\nstorage link resign");

await check("resignStorageLinks resigns expired links in nested objects", async () => {
  const expired = signStorageLink("photos/cat.png", -10000);
  const urlObj = new URL(`http://localhost${expired}`);
  const oldExp = urlObj.searchParams.get("exp");
  const oldSig = urlObj.searchParams.get("sig");
  assert.equal(storageLinkValid("photos/cat.png", oldExp, oldSig), false);

  const inputObj = {
    file: {
      name: "cat.png",
      url: expired,
    },
  };

  const resigned = resignStorageLinks(inputObj) as typeof inputObj;
  assert.notEqual(resigned.file.url, expired);

  const newUrlObj = new URL(`http://localhost${resigned.file.url}`);
  const newExp = newUrlObj.searchParams.get("exp");
  const newSig = newUrlObj.searchParams.get("sig");
  assert.equal(storageLinkValid("photos/cat.png", newExp, newSig), true);
});

await check("notebookRunsService.getById resigns expired storage links", async () => {
  const runId = `zz-test-resign-run-${Date.now()}`;
  const notebookId = `zz-test-resign-nb-${Date.now()}`;
  const expiredLink = signStorageLink("docs/report.pdf", -50000);

  await notebookRunsService.start({
    runId,
    notebookId,
    triggerSource: "manual",
  });

  await notebookRunsService.recordCell(runId, "cell1", {
    status: "done",
    output: { report: { url: expiredLink } },
    written: ["report"],
  });

  await notebookRunsService.finish(runId, "success");

  const run = await notebookRunsService.getById(runId);
  assert.ok(run, "run should exist");

  const cellOutput = (run.cell_results as Record<string, any>)["cell1"]?.output?.report;
  assert.ok(cellOutput?.url, "output url should exist");
  assert.notEqual(cellOutput.url, expiredLink, "link should have been resigned");

  const urlObj = new URL(`http://localhost${cellOutput.url}`);
  assert.equal(storageLinkValid("docs/report.pdf", urlObj.searchParams.get("exp"), urlObj.searchParams.get("sig")), true);

  await notebookRunsService.deleteByNotebook(notebookId);
});

await check("notebookRunsService.getLatestForNotebook resigns expired storage links", async () => {
  const runId = `zz-test-latest-run-${Date.now()}`;
  const notebookId = `zz-test-latest-nb-${Date.now()}`;
  const expiredLink = signStorageLink("docs/summary.pdf", -50000);

  await notebookRunsService.start({
    runId,
    notebookId,
    triggerSource: "manual",
  });

  await notebookRunsService.recordCell(runId, "cell1", {
    status: "done",
    output: { summary: { url: expiredLink } },
    written: ["summary"],
  });

  await notebookRunsService.finish(runId, "success");

  const run = await notebookRunsService.getLatestForNotebook(notebookId);
  assert.ok(run, "latest run should exist");

  const cellOutput = (run.cell_results as Record<string, any>)["cell1"]?.output?.summary;
  assert.ok(cellOutput?.url, "output url should exist");
  assert.notEqual(cellOutput.url, expiredLink, "link should have been resigned");

  const urlObj = new URL(`http://localhost${cellOutput.url}`);
  assert.equal(storageLinkValid("docs/summary.pdf", urlObj.searchParams.get("exp"), urlObj.searchParams.get("sig")), true);

  await notebookRunsService.deleteByNotebook(notebookId);
});

await check("notebookRunsService.listByNotebook returns run summaries", async () => {
  const notebookId = `zz-test-list-nb-${Date.now()}`;
  const runId = `zz-test-list-run-${Date.now()}`;

  await notebookRunsService.start({
    runId,
    notebookId,
    triggerSource: "manual",
  });

  await notebookRunsService.finish(runId, "success");

  const list = await notebookRunsService.listByNotebook(notebookId);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, runId);

  await notebookRunsService.deleteByNotebook(notebookId);
});

function parts(link: string): { exp: string | null; sig: string | null } {
  const u = new URL(`http://localhost${link}`);
  return { exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
}

await check("forged link (bogus sig) is not re-signed and stays invalid", async () => {
  const forged = "/storage/notebooks/x/file.html?exp=1&sig=AAAA";
  assert.equal(resignStorageLinks(forged), forged);
  const future = `/storage/notebooks/x/file.html?exp=${Date.now() + 100000}&sig=AAAA`;
  assert.equal((resignStorageLinks({ a: [future] }) as any).a[0], future);
  const { exp, sig } = parts(forged);
  assert.equal(storageLinkValid("notebooks/x/file.html", exp, sig), false);
});

await check("genuine expired link with awkward path is re-signed", async () => {
  for (const p of ["my photos/café ☃.png", "a/b#c?d.png", "100%/x.png"]) {
    const expired = signStorageLink(p, -10000);
    const out = resignStorageLinks(expired) as string;
    assert.notEqual(out, expired, p);
    const { exp, sig } = parts(out);
    assert.equal(storageLinkValid(p, exp, sig), true, p);
  }
});

await check("genuine link with tampered path is not re-signed", async () => {
  const genuine = signStorageLink("docs/mine.pdf", -10000);
  const tampered = genuine.replace("docs/mine.pdf", "docs/secret.pdf");
  assert.notEqual(tampered, genuine);
  assert.equal(resignStorageLinks(tampered), tampered);
  const encodedSlash = genuine.replace("docs/mine.pdf", "docs%2Fmine.pdf");
  assert.equal(resignStorageLinks(encodedSlash), encodedSlash);
});

await check("forged string with malformed percent-encoding does not throw", async () => {
  const bad = "/storage/a/%E0%A4%A/%zz.png?exp=1&sig=AAAA";
  assert.equal(resignStorageLinks(bad), bad);
  assert.deepEqual(resignStorageLinks([bad, { k: bad }]), [bad, { k: bad }]);
});

await check("notebookRunsService.getById leaves a forged link invalid", async () => {
  const runId = `zz-f6-run-${Date.now()}`;
  const notebookId = `zz-f6-nb-${Date.now()}`;
  const forged = "/storage/notebooks/x/file.html?exp=1&sig=AAAA";
  try {
    await notebookRunsService.start({ runId, notebookId, triggerSource: "manual" });
    await notebookRunsService.recordCell(runId, "cell1", {
      status: "done",
      output: { echoed: forged },
      written: ["echoed"],
    });
    await notebookRunsService.finish(runId, "success");
    const run = await notebookRunsService.getById(runId);
    assert.ok(run, "run should exist");
    const out = (run.cell_results as Record<string, any>)["cell1"]?.output?.echoed as string;
    assert.equal(out, forged);
    const { exp, sig } = parts(out);
    assert.equal(storageLinkValid("notebooks/x/file.html", exp, sig), false);
  } finally {
    await notebookRunsService.deleteByNotebook(notebookId);
  }
});

await pool.end();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

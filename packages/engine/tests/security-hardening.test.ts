import assert from "node:assert/strict";
import { corsPolicy } from "../src/server/app.js";

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

console.log("\nsecurity-hardening (T-01: CORS verification)");

await check("CORS policy in production with empty CORS_ORIGINS returns origin: false", () => {
  const oldEnv = process.env.NODE_ENV;
  const oldCors = process.env.CORS_ORIGINS;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGINS;
    const policy = corsPolicy();
    assert.deepEqual(policy, { origin: false });
  } finally {
    process.env.NODE_ENV = oldEnv;
    if (oldCors !== undefined) process.env.CORS_ORIGINS = oldCors;
    else delete process.env.CORS_ORIGINS;
  }
});

await check("CORS policy in production with declared CORS_ORIGINS returns list and credentials", () => {
  const oldEnv = process.env.NODE_ENV;
  const oldCors = process.env.CORS_ORIGINS;
  try {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://a.com,https://b.com";
    const policy = corsPolicy();
    assert.deepEqual(policy, { origin: ["https://a.com", "https://b.com"], credentials: true });
  } finally {
    process.env.NODE_ENV = oldEnv;
    if (oldCors !== undefined) process.env.CORS_ORIGINS = oldCors;
    else delete process.env.CORS_ORIGINS;
  }
});

await check("CORS policy in development with empty CORS_ORIGINS returns origin: true and credentials: true", () => {
  const oldEnv = process.env.NODE_ENV;
  const oldCors = process.env.CORS_ORIGINS;
  try {
    process.env.NODE_ENV = "development";
    delete process.env.CORS_ORIGINS;
    const policy = corsPolicy();
    assert.deepEqual(policy, { origin: true, credentials: true });
  } finally {
    process.env.NODE_ENV = oldEnv;
    if (oldCors !== undefined) process.env.CORS_ORIGINS = oldCors;
    else delete process.env.CORS_ORIGINS;
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);

console.log("\nsecurity-hardening (T-02: Login rate limiting)");

await check("login rate limiter returns 429 after exceeding LOGIN_RATE_LIMIT_MAX", async () => {
  const { createApp } = await import("../src/server/app.js");
  const { initDb } = await import("../src/db/initializer.js");
  const { pool } = await import("../src/db/connection.js");

  await initDb();
  process.env.LOGIN_RATE_LIMIT_MAX = "2";

  const app = createApp(() => {});

  // Simulate requests using supertest-like fetch against app/http server or mocked req/res
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const res1 = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "wrong-password-123" }),
    });
    assert.equal(res1.status, 401);

    const res2 = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "wrong-password-123" }),
    });
    assert.equal(res2.status, 401);

    const res3 = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "wrong-password-123" }),
    });
    assert.equal(res3.status, 429);
  } finally {
    server.close();
    delete process.env.LOGIN_RATE_LIMIT_MAX;
  }
});


console.log(`\n${passed} passed, ${failed} failed\n`);

console.log("\nsecurity-hardening (T-03: Webhook rate limiting)");

await check("webhook rate limiter skips authenticated requests and limits unauthenticated ones", async () => {
  const { createApp } = await import("../src/server/app.js");
  const { initDb } = await import("../src/db/initializer.js");
  const { pool } = await import("../src/db/connection.js");
  const { notebookTriggersService } = await import("../src/services/notebook-triggers.service.js");
  const { notebooksService } = await import("../src/services/notebooks.service.js");
  const { secretsService } = await import("../src/services/secrets.service.js");

  await initDb();
  process.env.HOOK_RATE_LIMIT_MAX = "2";

  const secretKey = `zz_test_secret_${Date.now()}`;
  const createdSecret = await secretsService.create(secretKey, "my-secret-value-123", true);

  const unauthedSlug = `zz-unauthed-hook-${Date.now()}`;
  const authedSlug = `zz-authed-hook-${Date.now()}`;

  // Create notebook with webhook triggers
  const nb = await notebooksService.save({
    name: "zz-test-hook-nb",
    triggers: [
      { id: "t1", kind: "webhook", slug: unauthedSlug, enabled: true },
      { id: "t2", kind: "webhook", slug: authedSlug, secretKey, enabled: true },
    ],
  });
  await notebooksService.deploy(nb.id, "test");



  const app = createApp(() => {});
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    // Unauthenticated webhook rate limiting (max 2)
    const res1 = await fetch(`http://127.0.0.1:${port}/hooks/${unauthedSlug}`, { method: "POST" });
    assert.equal(res1.status, 202);

    const res2 = await fetch(`http://127.0.0.1:${port}/hooks/${unauthedSlug}`, { method: "POST" });
    assert.equal(res2.status, 202);

    const res3 = await fetch(`http://127.0.0.1:${port}/hooks/${unauthedSlug}`, { method: "POST" });
    assert.equal(res3.status, 429);

    // Authenticated webhook requests should skip rate limiting
    for (let i = 0; i < 5; i++) {
      const authedRes = await fetch(`http://127.0.0.1:${port}/hooks/${authedSlug}`, {
        method: "POST",
        headers: { "X-Webhook-Secret": "my-secret-value-123" },
      });
      assert.equal(authedRes.status, 202, `Authenticated request ${i + 1} should succeed with 202`);
    }
  } finally {
    server.close();
    await notebooksService.delete(nb.id);
    await secretsService.delete(createdSecret.id);
    delete process.env.HOOK_RATE_LIMIT_MAX;
  }
});



console.log(`\n${passed} passed, ${failed} failed\n`);

console.log("\nsecurity-hardening (T-04: Minimum password length)");

await check("minimum password length is 12 and refuses 11 characters while accepting 12 simple characters", async () => {
  const { authService, MIN_PASSWORD_LENGTH } = await import("../src/services/auth.service.js");
  const { initDb } = await import("../src/db/initializer.js");

  await initDb();
  assert.equal(MIN_PASSWORD_LENGTH, 12);

  const u11 = `user11_${Date.now()}`;
  const u12 = `user12_${Date.now()}`;

  // 11 characters -> refused
  await assert.rejects(
    async () => {
      await authService.createUser(u11, "elevenchars", "viewer");
    },
    (err: Error) => {
      return err.message.includes("at least 12 characters");
    }
  );

  // 12 characters plain -> accepted
  const user = await authService.createUser(u12, "twelvecharsa", "viewer");
  assert.ok(user.id);
  assert.equal(user.username, u12);
});


console.log(`\n${passed} passed, ${failed} failed\n`);

console.log("\nsecurity-hardening (T-05: Agent tokens endpoints)");

await check("creator can issue, list, and revoke agent tokens; viewer is refused with 403", async () => {
  const { createApp } = await import("../src/server/app.js");
  const { initDb } = await import("../src/db/initializer.js");
  const { authService } = await import("../src/services/auth.service.js");

  await initDb();

  const creatorName = `creator_${Date.now()}`;
  const viewerName = `viewer_${Date.now()}`;
  const password = "password123456";

  const creator = await authService.createUser(creatorName, password, "creator");
  const viewer = await authService.createUser(viewerName, password, "viewer");

  const creatorLogin = await authService.login(creatorName, password);
  const viewerLogin = await authService.login(viewerName, password);

  const creatorToken = creatorLogin.token;
  const viewerToken = viewerLogin.token;

  const app = createApp(() => {});
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    // 1. Viewer is refused 403 on POST, GET, DELETE
    const vPost = await fetch(`http://127.0.0.1:${port}/api/agent-tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${viewerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "test-viewer-agent" }),
    });
    assert.equal(vPost.status, 403);

    const vGet = await fetch(`http://127.0.0.1:${port}/api/agent-tokens`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(vGet.status, 403);

    const vDel = await fetch(`http://127.0.0.1:${port}/api/agent-tokens/fake-id`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(vDel.status, 403);

    // 2. Creator can issue token
    const cPost = await fetch(`http://127.0.0.1:${port}/api/agent-tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creatorToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Hermes Bot", scope: "author" }),
    });
    assert.equal(cPost.status, 201);
    const postData = (await cPost.json()) as { token: string; record: { id: string; label: string } };
    assert.ok(postData.token.startsWith("zaa_"), "token should have zaa_ prefix");
    assert.equal(postData.record.label, "Hermes Bot");

    const tokenId = postData.record.id;

    // 3. Creator can list tokens (does NOT contain plain text token)
    const cGet = await fetch(`http://127.0.0.1:${port}/api/agent-tokens`, {
      headers: { Authorization: `Bearer ${creatorToken}` },
    });
    assert.equal(cGet.status, 200);
    const listData = (await cGet.json()) as any[];
    const found = listData.find((t) => t.id === tokenId);
    assert.ok(found, "token record should be in list");
    assert.equal(found.token, undefined, "plain text token should not be in list record");

    // 4. Creator can revoke token
    const cDel = await fetch(`http://127.0.0.1:${port}/api/agent-tokens/${tokenId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${creatorToken}` },
    });
    assert.equal(cDel.status, 200);

    // List after revoke should no longer contain token
    const cGetAfter = await fetch(`http://127.0.0.1:${port}/api/agent-tokens`, {
      headers: { Authorization: `Bearer ${creatorToken}` },
    });
    const listAfter = (await cGetAfter.json()) as any[];
    assert.equal(listAfter.find((t) => t.id === tokenId), undefined);
  } finally {
    server.close();
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);

console.log("\nsecurity-hardening (T-07: Python package version locking)");

await check("deploying a python notebook pins packages to locked_packages in database", async () => {
  const { notebooksService } = await import("../src/services/notebooks.service.js");
  const { initDb } = await import("../src/db/initializer.js");
  const { pool } = await import("../src/db/connection.js");

  await initDb();

  const nb = await notebooksService.save({
    name: "zz-python-lock-test",
    runtime: "python",
    packages: ["cowsay"],
  });

  const deployRes = await notebooksService.deploy(nb.id, "test");
  assert.ok(deployRes?.versionId);

  // 1. Verify DB contains locked_packages
  const { rows } = await pool.query(
    "SELECT locked_packages FROM notebook_versions WHERE id = $1",
    [deployRes.versionId]
  );
  assert.equal(rows.length, 1);
  const locked = rows[0].locked_packages;
  assert.ok(Array.isArray(locked), "locked_packages should be an array");
  assert.ok(locked.length > 0, "locked_packages should not be empty");
  assert.ok(locked[0].startsWith("cowsay"), "locked package should start with cowsay");

  // 2. Verify getDeployedDocument returns locked_packages
  const deployedDoc = await notebooksService.getDeployedDocument(nb.id);
  assert.ok(deployedDoc);
  assert.deepEqual(deployedDoc.packages, locked);

  // 3. Verify draft still returns raw packages
  const draftRecord = await notebooksService.getById(nb.id);
  assert.ok(draftRecord);
  const draftDoc = notebooksService.parseDocument(draftRecord);
  assert.deepEqual(draftDoc.packages, ["cowsay"]);

  await notebooksService.delete(nb.id);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
const { pool } = await import("../src/db/connection.js");
await pool.end();
if (failed > 0) process.exit(1);







/**
 * Shared by the K-10 tests (run deadline, cancel, nested fan-out, cron queue).
 * Not a test itself: `run-all.ts` only picks up `*.test.ts`.
 *
 * Everything these tests create is prefixed `zz-k10-` and removed at the start and the end.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pool } from "../src/db/connection.js";
import { notebooksService } from "../src/services/notebooks.service.js";
import { notebookRunsService } from "../src/services/notebook-runs.service.js";
import { testOwner, dropOwner } from "./owners.js";
import type { NotebookJson } from "@zaa-tool/shared";

/** The account these notebooks belong to: since FX-17 a notebook without one calls nothing. */
let owner: { id: string } | null = null;

export function makeCheck() {
  const tally = { passed: 0, failed: 0 };
  async function check(name: string, run: () => Promise<void> | void): Promise<void> {
    try {
      await run();
      tally.passed += 1;
      console.log(`  ok   ${name}`);
    } catch (err) {
      tally.failed += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${(err as Error).message.split("\n").join("\n       ")}`);
    }
  }
  return { check, tally };
}

/**
 * Without this a test run against code that has no deadline would hang forever on the very
 * loop it is checking for. The watchdog turns "never ends" into a failed run.
 */
export function watchdog(ms: number): NodeJS.Timeout {
  return setTimeout(() => {
    console.log(`\n  FAIL watchdog: the test file did not finish in ${ms} ms`);
    process.exit(2);
  }, ms);
}

export async function cleanupNotebooks(): Promise<void> {
  owner = null;
  const { rows } = await pool.query("SELECT id FROM notebooks WHERE name LIKE 'zz-k10-%'");
  for (const row of rows) {
    await notebookRunsService.deleteByNotebook(row.id).catch(() => {});
    await notebooksService.delete(row.id).catch(() => {});
  }
  await dropOwner("k10");
}

export async function store(doc: Partial<NotebookJson> & { name: string }): Promise<string> {
  owner ??= await testOwner("k10");
  const saved = await notebooksService.save(
    {
      version: "1.0",
      id: "",
      runtime: "node",
      steps: [],
      ...doc,
    } as NotebookJson,
    "test",
    owner.id
  );
  return saved.id;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  ms: number
): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined || Date.now() > end) return v;
    await sleep(100);
  }
}

export function alive(pid: number): boolean {
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

export function killPid(pid: number): void {
  if (!alive(pid)) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else process.kill(pid, "SIGKILL");
  } catch {
    // gone
  }
}

/** The stored run, once it is no longer `running`. */
export async function finishedRun(runId: string, ms = 30_000) {
  return waitFor(async () => {
    const run = await notebookRunsService.getById(runId);
    return run && run.status !== "running" ? run : undefined;
  }, ms);
}

/** A pid a cell wrote to a file, once it has. */
export function readPid(file: string): number | undefined {
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, "utf8").trim();
  return text ? Number(text) : undefined;
}

/** For a test whose own creator account should be the owner of what it stores. */
export function setOwner(id: string): void {
  owner = { id };
}

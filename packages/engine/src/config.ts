/**
 * What the environment is allowed to decide, and what it must decide.
 *
 * Two rules hold this file together:
 *
 *  - **A default may be convenient, never a secret.** `JWT_SECRET` had a fallback written
 *    into the repository, which meant every checkout of this project could mint a valid
 *    session for every deployment of it. A development fallback is fine; carrying it into
 *    production is not, so production refuses to start instead.
 *  - **The permissive setting is the one you have to ask for.** Registration defaults to
 *    closed. A machine that is reachable from the internet before anyone has read this
 *    file should not be handing out accounts.
 *
 * Read at call time rather than frozen at import, so a test can set a variable and a
 * script can run under different settings without reloading modules.
 */

import {
  cellSpawnIdentity,
  readSandboxIdentity,
  sandboxProblems,
  type CellSpawnIdentity,
  type SandboxIdentity,
} from "./core/sandbox-identity.js";

/** Obvious on sight, and long enough that nothing accidentally depends on its shape. */
const DEV_JWT_SECRET = "zaatool-development-secret-do-not-deploy";

/** Shortest secret worth having. 32 bytes of anything unguessable clears it. */
const MIN_SECRET_LENGTH = 32;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The key behind sessions, share links and storage signatures.
 *
 * One secret with three uses, separated by {@link signingKey}'s label rather than by
 * three variables to lose.
 */
export function jwtSecret(): string {
  return process.env.JWT_SECRET?.trim() || DEV_JWT_SECRET;
}

export function usingDevSecret(): boolean {
  return jwtSecret() === DEV_JWT_SECRET;
}

/**
 * Closed unless told otherwise — with one exception the caller owns: an installation with
 * no users at all always accepts the first one, or there would be no way in.
 */
export function registrationOpen(): boolean {
  return (process.env.ALLOW_REGISTRATION ?? "").trim().toLowerCase() === "true";
}

/** Bytes. A limit that exists is the point; the number is a preference. */
export function maxUploadBytes(): number {
  const raw = Number(process.env.MAX_UPLOAD_MB);
  const megabytes = Number.isFinite(raw) && raw > 0 ? raw : 25;
  return Math.floor(megabytes * 1024 * 1024);
}

/**
 * Bytes. The default ceiling for a JSON request body. It is small because several routes
 * (webhooks, shared pages, MCP) are parsed before anyone has proved who they are, and a
 * body is held in memory whole. See `notebookJsonBodyLimit` for the one place that needs more.
 */
export function jsonBodyLimit(): number {
  const raw = Number(process.env.MAX_JSON_BODY_MB);
  const megabytes = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return Math.floor(megabytes * 1024 * 1024);
}

/** Bytes. For `/api/notebooks` only: behind a session, and carries whole documents. */
export function notebookJsonBodyLimit(): number {
  const raw = Number(process.env.MAX_NOTEBOOK_JSON_MB);
  const megabytes = Number.isFinite(raw) && raw > 0 ? raw : 50;
  return Math.floor(megabytes * 1024 * 1024);
}

export function loginRateLimitWindowMs(): number {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60 * 1000;
}

export function loginRateLimitMax(): number {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

export function hookRateLimitWindowMs(): number {
  const raw = Number(process.env.HOOK_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60 * 1000;
}

export function hookRateLimitMax(): number {
  const raw = Number(process.env.HOOK_RATE_LIMIT_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

/**
 * Which hops Express believes when it reads `X-Forwarded-For`.
 *
 * Both ways in — nginx in production, the Vite proxy in development — are proxies, so
 * without this `req.ip` is the proxy's address for every visitor and the login and
 * webhook limiters share one bucket for the whole world: anyone can lock everyone out.
 *
 * The default trusts loopback and private-network peers only. That covers the compose
 * network and a local dev server, and it does not cover the internet: an engine reached
 * directly by a stranger ignores whatever `X-Forwarded-For` they send. `TRUST_PROXY` takes
 * `false` or `0` (trust nothing), a hop count (`1`), `true` (trust everything — do not;
 * it lets anyone pick their own address), or Express's own list of names and subnets.
 */
export function trustProxy(): boolean | number | string {
  const raw = (process.env.TRUST_PROXY ?? "").trim();
  if (raw === "") return "loopback, linklocal, uniquelocal";
  const lowered = raw.toLowerCase();
  if (lowered === "false" || lowered === "0") return false;
  if (lowered === "true") return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Milliseconds one root notebook run may take in total, nested calls included.
 *
 * A cell's own timeout stops counting while it waits on `notebooks.run` or `files.write`,
 * so by itself it cannot bound a chain: `while (true) await notebooks.run(...)` never ends
 * and holds a run slot for good. This is the clock that does. When it runs out every cell
 * in the chain is stopped and the run fails.
 */
export function maxRunMs(): number {
  const raw = Number(process.env.MAX_RUN_SECONDS);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : 900;
  return Math.floor(seconds * 1000);
}

function positiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

/** How many `notebooks.run` calls one root run may have executing at the same time. */
export function maxNestedConcurrency(): number {
  return positiveInt("MAX_NESTED_CONCURRENCY", 4);
}

/** How many `notebooks.run` calls one root run may make in total. */
export function maxNestedCalls(): number {
  return positiveInt("MAX_NESTED_CALLS", 200);
}

/**
 * Megabytes of JavaScript heap one cell process may use before it is stopped.
 *
 * A cell runs in a process of its own (see `js-runner`), so this is `--max-old-space-size`
 * on that process: a cell that allocates without end fails with an out-of-memory error and
 * the engine, which is a different process, carries on. It bounds the JS heap; memory held
 * outside it (large Buffers) is not counted by this flag.
 */
export function maxCellMemoryMb(): number {
  return positiveInt("MAX_CELL_MEMORY_MB", 512);
}

export function maxNotebookStorageBytes(): number {
  const raw = Number(process.env.MAX_NOTEBOOK_STORAGE_MB);
  const megabytes = Number.isFinite(raw) && raw > 0 ? raw : 500;
  return Math.floor(megabytes * 1024 * 1024);
}

/**
 * The unprivileged user cells run as, from `SANDBOX_UID` / `SANDBOX_GID` / `SANDBOX_HOME`.
 * Unset (or missing either id) means no drop: cells run as the engine does. See
 * `core/sandbox-identity` for what is done with it, and why only on POSIX.
 */
export function sandboxIdentity(): SandboxIdentity | undefined {
  return readSandboxIdentity(process.env);
}

/** Spawn options and environment that put a cell child under {@link sandboxIdentity}. */
export function cellIdentity(): CellSpawnIdentity {
  return cellSpawnIdentity(process.platform, process.env, process.getuid?.bind(process));
}

/**
 * Reasons this process should not be serving traffic.
 *
 * Returns them all rather than the first, so a deployment is fixed in one pass instead of
 * one restart per mistake.
 */
export function configProblems(): string[] {
  // Not behind the production check: a half-set sandbox is wrong in development too, and
  // the cost of finding out is every cell failing.
  const problems: string[] = sandboxProblems(process.platform, process.env, process.getuid?.bind(process));
  if (!isProduction()) return problems;

  if (usingDevSecret()) {
    problems.push(
      "JWT_SECRET is not set. In production the engine will not fall back to the " +
        "development secret, because that secret is in the repository — anyone holding a " +
        "copy could sign a session for this machine."
    );
  } else if (jwtSecret().length < MIN_SECRET_LENGTH) {
    problems.push(
      `JWT_SECRET is ${jwtSecret().length} characters; ${MIN_SECRET_LENGTH} is the minimum. ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  return problems;
}

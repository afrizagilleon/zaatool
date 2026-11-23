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

import { activeSandbox, sandboxProblems, type SandboxConfig } from "./core/sandbox-identity.js";
import { prlimitAvailable } from "./core/cell-limits.js";
import { isValidTimeZone } from "./core/cron.js";
import { parseSecretsKey } from "./core/secrets-crypto.js";

/** Obvious on sight, and long enough that nothing accidentally depends on its shape. */
const DEV_JWT_SECRET = "zaatool-development-secret-do-not-deploy";

/** Shortest secret worth having. 32 bytes of anything unguessable clears it. */
const MIN_SECRET_LENGTH = 32;

/** The one time zone every cron trigger is read in. IANA name; UTC unless `CRON_TZ` says otherwise. */
export function cronTimezone(): string {
  return process.env.CRON_TZ?.trim() || "UTC";
}

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
 * The key that encrypts the `secrets` table (`SECRETS_KEY`: 32 bytes as 64 hex characters).
 * Null when unset or malformed; `configProblems` says which, and refuses in production.
 * Lose it and every stored secret is gone, so it is kept apart from the database backup.
 */
export function secretsKey(): Buffer | null {
  return parseSecretsKey(process.env.SECRETS_KEY);
}

/** `CORS_ORIGINS` as a list: the origins a browser may call this engine from, and open its socket from. */
export function declaredCorsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
}

/**
 * Whether the session cookie is marked `Secure` (sent over HTTPS only).
 *
 * On by default in production, off elsewhere, and `COOKIE_SECURE=true|false` overrides
 * either. It is a setting rather than "whatever the request looks like" because behind
 * Caddy and then nginx the `X-Forwarded-Proto` that reaches the engine is `http` — nginx
 * overwrites it — so the engine cannot see that the visitor is on HTTPS. Trying out a
 * production build over plain HTTP needs `COOKIE_SECURE=false`, or the browser will
 * accept the cookie and then never send it back.
 */
export function cookieSecure(): boolean {
  const raw = (process.env.COOKIE_SECURE ?? "").trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return isProduction();
}

/**
 * Closed unless told otherwise — with one exception the caller owns: an installation with
 * no users at all always accepts the first one, or there would be no way in.
 */
export function registrationOpen(): boolean {
  return (process.env.ALLOW_REGISTRATION ?? "").trim().toLowerCase() === "true";
}

/**
 * The setup code the operator chose with `SETUP_CODE`, or null. Without one the engine makes
 * a random code of its own while there are no accounts; see `auth.service.ts`.
 */
export function setupCodeOverride(): string | null {
  const raw = process.env.SETUP_CODE?.trim();
  return raw ? raw : null;
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

/**
 * Password guesses allowed at shared pages, per client address and per link, in the login
 * window. Each guess is a bcrypt comparison on a thread pool of four, so the number is the
 * cost an anonymous caller may impose, not only a guard against guessing.
 */
export function sharePasswordIpMax(): number {
  const raw = Number(process.env.SHARE_PASSWORD_IP_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

export function sharePasswordLinkMax(): number {
  const raw = Number(process.env.SHARE_PASSWORD_LINK_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
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
 * The default trusts loopback and private-network peers only. That covers a local dev
 * server, and it does not cover the internet: an engine reached directly by a stranger
 * ignores whatever `X-Forwarded-For` they send. docker-compose sets `1` instead, because
 * nginx can see a client on a private address too, and under this default that client
 * could name its own address (K-28). `TRUST_PROXY` takes
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
 * the engine, which is a different process, carries on. The flag bounds the JS heap only;
 * memory held outside it (large Buffers) is bounded on Linux with the sandbox on by the kernel
 * limit that {@link cellLimits} describes, and not at all elsewhere.
 */
export function maxCellMemoryMb(): number {
  return positiveInt("MAX_CELL_MEMORY_MB", 512);
}

/**
 * Megabytes of private memory one Python cell process may hold (Linux, sandbox on; Python has
 * no heap cap of its own, so this is the whole limit). Its own variable because a numeric
 * cell (pandas, numpy) legitimately needs more than a JavaScript one: 1024, where JavaScript
 * keeps `MAX_CELL_MEMORY_MB`.
 */
export function maxPythonCellMemoryMb(): number {
  return positiveInt("MAX_PYTHON_CELL_MEMORY_MB", 1024);
}

/**
 * The hard limits a JavaScript cell process gets on Linux when the sandbox uid is on (see
 * `core/cell-limits`): memory is `MAX_CELL_MEMORY_MB` again, now enforced by the kernel on
 * the whole process (V8 heap, Buffers), not only the V8 heap. {@link pythonCellLimits} is the
 * same for Python, with its own memory.
 *
 * `MAX_CELL_PROCESSES` is the number of processes *and threads* one cell process may have,
 * the cell and everything it starts (the kernel counts per uid, and every cell process has a
 * uid of its own). A Node cell is about a dozen threads and a Python cell with numpy a
 * handful, so 128 leaves room for a cell that starts workers and stops a fork bomb at that
 * size. The container's `ENGINE_PIDS_LIMIT` (4096 by default, 32 cells at this limit) is the
 * bound over all of them: the run gate admits four runs, but the notebooks a run calls do not
 * pass the gate and add cell processes of their own.
 *
 * `MAX_CELL_FILE_MB` is the largest single file a cell may write. It is generous on purpose:
 * it stops one runaway `write` from filling the disk in a single file, not a notebook
 * that legitimately produces a big output (use `MAX_NOTEBOOK_STORAGE_MB` for what is kept).
 */
export function cellLimits(): { memoryMb: number; processes: number; fileMb: number } {
  return {
    memoryMb: maxCellMemoryMb(),
    processes: positiveInt("MAX_CELL_PROCESSES", 128),
    fileMb: positiveInt("MAX_CELL_FILE_MB", 1024),
  };
}

/**
 * Disk one notebook owner's cells may occupy outside kept files (`MAX_OWNER_DISK_MB`, default
 * 2048): their temp folder and package cache, measured before each cell (see `core/owner-disk`).
 * Over it, the owner's next cell is refused until the idle cleanup has emptied their temp folder.
 */
export function maxOwnerDiskBytes(): number {
  return positiveInt("MAX_OWNER_DISK_MB", 2048) * 1024 * 1024;
}

/** The limits of a Python cell process: {@link cellLimits} with {@link maxPythonCellMemoryMb}. */
export function pythonCellLimits(): { memoryMb: number; processes: number; fileMb: number } {
  return { ...cellLimits(), memoryMb: maxPythonCellMemoryMb() };
}

/**
 * The limits of `uv` installing a notebook's packages (at deploy, and when a run first needs
 * an environment), on Linux with the sandbox on. Looser than a cell's because the work is
 * different: resolving, downloading and unpacking wheels (and building from source) takes
 * memory the notebook never holds, `uv` runs a thread per core and more, and a wheel such as
 * torch is over a gigabyte. They are still limits: a package whose build script forks without
 * end, or writes without end, stops here instead of taking the container with it.
 *
 *  - `MAX_INSTALL_MEMORY_MB` (default 4096): private memory of `uv` and what it builds.
 *  - `MAX_INSTALL_PROCESSES` (default 1024): processes and threads, `uv` and its builds together.
 *  - `MAX_INSTALL_FILE_MB` (default 4096): the largest single file it may write.
 */
export function installLimits(): { memoryMb: number; processes: number; fileMb: number } {
  return {
    memoryMb: positiveInt("MAX_INSTALL_MEMORY_MB", 4096),
    processes: positiveInt("MAX_INSTALL_PROCESSES", 1024),
    fileMb: positiveInt("MAX_INSTALL_FILE_MB", 4096),
  };
}

export function maxNotebookStorageBytes(): number {
  const raw = Number(process.env.MAX_NOTEBOOK_STORAGE_MB);
  const megabytes = Number.isFinite(raw) && raw > 0 ? raw : 500;
  return Math.floor(megabytes * 1024 * 1024);
}

/**
 * The sandbox in force on this machine, from `SANDBOX_GID` / `SANDBOX_UID_BASE` /
 * `SANDBOX_UID_COUNT` / `SANDBOX_HOME`: configured, not Windows, and this process is root.
 * Undefined means no drop: cells run as the engine does. See `core/sandbox-identity` for
 * what is done with it, and why only on POSIX.
 */
export function activeSandboxConfig(): SandboxConfig | undefined {
  return activeSandbox(process.platform, process.env, process.getuid?.bind(process));
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
  // Cells are started under `prlimit` whenever they are dropped to a uid of their own; without
  // it every one of them would fail to start, so this is as much a startup error as a
  // half-set sandbox.
  if (activeSandboxConfig() && !prlimitAvailable()) {
    problems.push(
      "prlimit (util-linux) is not installed at /usr/bin/prlimit, and cells cannot be started " +
        "under their resource limits without it. The official image has it."
    );
  }
  if (!isValidTimeZone(cronTimezone())) {
    problems.push(
      `CRON_TZ is "${cronTimezone()}", which is not an IANA time zone name. Use a name like ` +
        "Asia/Jakarta or UTC, or leave it unset for UTC."
    );
  }
  const rawSecretsKey = process.env.SECRETS_KEY?.trim() ?? "";
  if (rawSecretsKey !== "" && secretsKey() === null) {
    problems.push(
      "SECRETS_KEY is not 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32"
    );
  } else if (rawSecretsKey === "" && isProduction()) {
    problems.push(
      "SECRETS_KEY is not set. In production, secrets are stored encrypted and the engine " +
        "will not keep them in plaintext. Generate one with: openssl rand -hex 32 — and keep " +
        "a copy apart from your database backups: without it every stored secret is lost."
    );
  }

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

/**
 * How many of the engine's run slots one account's notebooks may hold at once. Without a
 * share, one owner (one webhook hit in a loop) fills the whole gate and everyone else is
 * refused. `fallback` is half the slots, rounded up, and never less than one.
 */
export function maxRunsPerOwner(fallback: number): number {
  return positiveInt("MAX_RUNS_PER_OWNER", fallback);
}

/** How many runs one account may have waiting for a slot, with the same reasoning as above. */
export function maxQueuedRunsPerOwner(fallback: number): number {
  return positiveInt("MAX_QUEUED_RUNS_PER_OWNER", fallback);
}

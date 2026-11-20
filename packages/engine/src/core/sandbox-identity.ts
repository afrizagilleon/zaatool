/**
 * Which operating-system user a cell runs as.
 *
 * On Linux (the Docker image) the engine starts as root and every cell process — JavaScript,
 * Python, and the `uv` run that installs a notebook's packages — is spawned as an
 * unprivileged user instead. Since FX-20 that user is **per owner**: each account that owns
 * a notebook gets a uid of its own (`SANDBOX_UID_BASE` + allocation order), and every cell
 * of a notebook runs as its owner's uid. A cell of one owner cannot then read another
 * owner's `/proc/<pid>/environ` (secrets), files or package cache, because the kernel says
 * no, whatever the cell's code does. Windows has no equivalent of `uid`, so there this does
 * nothing and the JavaScript permission model is the only boundary.
 *
 * Pure functions of their inputs (platform, environment, `getuid`), so the decision can be
 * tested on a machine that is none of Linux, root or Docker. Nothing here reads `process`.
 */

export interface SandboxConfig {
  /** First uid handed to an owner. */
  uidBase: number;
  /** How many uids there are: owner number `uidCount + 1` cannot run a cell. */
  uidCount: number;
  /** Shared group of every cell user. It is never used to give one owner access to another. */
  gid: number;
  /** Parent of `owners/<uid>/`: each owner's HOME, temp folder, uv cache and per-process folders. */
  home: string;
}

export interface CellSpawnIdentity {
  /** Spread into `spawn`'s options: `{ uid, gid }`, or nothing. */
  options: { uid?: number; gid?: number };
  /** Merged over the cell's environment so HOME, TMPDIR and uv's cache are the owner's. */
  env: Record<string, string>;
}

const DEFAULT_HOME = "/home/sandbox";
const DEFAULT_UID_BASE = 20000;
const DEFAULT_UID_COUNT = 40000;
/** 2^32 - 2 is the highest uid Linux accepts (2^32 - 1 means "unchanged"). */
const MAX_UID = 4294967294;

function id(raw: string | undefined): number | undefined {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return undefined;
  return Number(text);
}

function blank(raw: string | undefined): boolean {
  return (raw ?? "").trim() === "";
}

/**
 * `SANDBOX_GID` with `SANDBOX_UID_BASE` / `SANDBOX_UID_COUNT` (which have defaults), or
 * undefined when the sandbox was not asked for or its numbers are malformed or out of range.
 */
export function readSandboxConfig(env: Record<string, string | undefined>): SandboxConfig | undefined {
  const gid = id(env.SANDBOX_GID);
  if (gid === undefined || gid === 0) return undefined;
  const uidBase = blank(env.SANDBOX_UID_BASE) ? DEFAULT_UID_BASE : id(env.SANDBOX_UID_BASE);
  const uidCount = blank(env.SANDBOX_UID_COUNT) ? DEFAULT_UID_COUNT : id(env.SANDBOX_UID_COUNT);
  if (uidBase === undefined || uidCount === undefined) return undefined;
  if (uidBase < 1 || uidCount < 1 || uidBase + uidCount - 1 > MAX_UID) return undefined;
  const home = (env.SANDBOX_HOME ?? "").trim() || DEFAULT_HOME;
  return { uidBase, uidCount, gid, home };
}

/** The last uid in the range. */
export function lastSandboxUid(config: SandboxConfig): number {
  return config.uidBase + config.uidCount - 1;
}

/** `${home}/owners/<uid>`: root of everything one owner's cells may touch. */
export function ownerHomePath(config: SandboxConfig, uid: number): string {
  return `${config.home.replace(/\/+$/, "")}/owners/${uid}`;
}

/**
 * The sandbox in force here, or undefined: not Windows, configured, and this process is
 * root — a process that is not root cannot change uid, and `spawn` would throw EPERM on
 * every cell. That last case is refused at startup by {@link sandboxProblems}, so reaching
 * it here is only a defence.
 */
export function activeSandbox(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  getuid: (() => number) | undefined
): SandboxConfig | undefined {
  if (platform === "win32") return undefined;
  const config = readSandboxConfig(env);
  if (!config) return undefined;
  if (!getuid || getuid() !== 0) return undefined;
  return config;
}

/** Spawn options and environment that put a cell child under owner uid `uid`. */
export function ownerSpawnIdentity(config: SandboxConfig, uid: number): CellSpawnIdentity {
  if (!Number.isInteger(uid) || uid < config.uidBase || uid > lastSandboxUid(config)) {
    throw new Error(`Sandbox uid ${uid} is outside ${config.uidBase}..${lastSandboxUid(config)}.`);
  }
  const home = ownerHomePath(config, uid);
  return {
    options: { uid, gid: config.gid },
    env: {
      HOME: home,
      TMPDIR: `${home}/tmp`,
      UV_CACHE_DIR: `${home}/.cache/uv`,
    },
  };
}

/** True when any sandbox variable is set to anything at all. */
function requested(env: Record<string, string | undefined>): boolean {
  return !blank(env.SANDBOX_UID_BASE) || !blank(env.SANDBOX_UID_COUNT) || !blank(env.SANDBOX_GID);
}

/** Reasons the sandbox identity cannot be honoured, in the words the operator needs. */
export function sandboxProblems(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  getuid: (() => number) | undefined
): string[] {
  if (platform === "win32") return [];

  const problems: string[] = [];
  if (!blank(env.SANDBOX_UID)) {
    problems.push(
      "SANDBOX_UID is no longer used: since FX-20 every owner's cells run as a uid of their own. " +
        "Remove SANDBOX_UID and set SANDBOX_UID_BASE (default 20000) and SANDBOX_UID_COUNT " +
        "(default 40000) if you need other numbers; SANDBOX_GID stays."
    );
  }
  if (!requested(env)) return problems;

  if (blank(env.SANDBOX_GID)) {
    problems.push("SANDBOX_GID must be set, to a plain number, for cells to run as an unprivileged user.");
  } else if (id(env.SANDBOX_GID) === undefined || id(env.SANDBOX_GID) === 0) {
    problems.push("SANDBOX_GID must be a plain number other than 0: 0 is root's group, which cells must not run as.");
  }
  for (const name of ["SANDBOX_UID_BASE", "SANDBOX_UID_COUNT"] as const) {
    if (!blank(env[name]) && (id(env[name]) === undefined || id(env[name]) === 0)) {
      problems.push(`${name} must be a plain number greater than 0 (uid 0 is root).`);
    }
  }
  if (problems.length === 0 && !readSandboxConfig(env)) {
    problems.push(
      `SANDBOX_UID_BASE + SANDBOX_UID_COUNT - 1 must not pass ${MAX_UID}, the highest uid Linux has.`
    );
  }
  if (problems.length === 0 && (!getuid || getuid() !== 0)) {
    problems.push(
      `The sandbox is configured, but the engine is not running as root (uid ${getuid ? getuid() : "unknown"}), ` +
        "so it could not switch a cell to its owner's user and every cell would fail. Run the engine as " +
        "root (the Docker image does) or unset SANDBOX_GID, SANDBOX_UID_BASE and SANDBOX_UID_COUNT."
    );
  }
  return problems;
}

/** Things worth saying once at startup that are not reasons to refuse. */
export function sandboxWarnings(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  if (platform === "win32" && (requested(env) || !blank(env.SANDBOX_UID))) {
    return ["SANDBOX_* variables are ignored on Windows: cells cannot be run as another user here."];
  }
  return [];
}

/**
 * Which operating-system user a cell runs as.
 *
 * On Linux (the Docker image) the engine starts as root and every cell process — JavaScript,
 * Python, and the `uv` run that installs a notebook's packages — is spawned as an
 * unprivileged user instead. That user cannot read the engine's environment
 * (`/proc/<pid>/environ` belongs to root), cannot read files the engine keeps root-only, and
 * cannot write anywhere the image does not give it. Windows has no equivalent of `uid`, so
 * there this does nothing and the JavaScript permission model is the only boundary.
 *
 * Pure functions of their inputs (platform, environment, `getuid`), so the decision can be
 * tested on a machine that is none of Linux, root or Docker. Nothing here reads `process`.
 */

export interface SandboxIdentity {
  uid: number;
  gid: number;
  /** Home of the unprivileged user: its HOME, its temp folder and its uv cache live here. */
  home: string;
}

export interface CellSpawnIdentity {
  /** Spread into `spawn`'s options: `{ uid, gid }`, or nothing. */
  options: { uid?: number; gid?: number };
  /** Merged over the cell's environment so HOME, TMPDIR and uv's cache are the sandbox user's. */
  env: Record<string, string>;
}

const DEFAULT_HOME = "/home/sandbox";

function id(raw: string | undefined): number | undefined {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return undefined;
  return Number(text);
}

/** `SANDBOX_UID` and `SANDBOX_GID` together, or undefined when either is missing or malformed. */
export function readSandboxIdentity(env: Record<string, string | undefined>): SandboxIdentity | undefined {
  const uid = id(env.SANDBOX_UID);
  const gid = id(env.SANDBOX_GID);
  if (uid === undefined || gid === undefined) return undefined;
  const home = (env.SANDBOX_HOME ?? "").trim() || DEFAULT_HOME;
  return { uid, gid, home };
}

/**
 * Spawn options (and environment) that put a cell child under the sandbox user.
 *
 * Nothing unless: not Windows, both ids configured, and this process is root — a process
 * that is not root cannot change uid, and `spawn` would throw EPERM on every cell. That
 * last case is refused at startup by {@link sandboxProblems}, so reaching it here is only
 * a defence.
 */
export function cellSpawnIdentity(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  getuid: (() => number) | undefined
): CellSpawnIdentity {
  const none: CellSpawnIdentity = { options: {}, env: {} };
  if (platform === "win32") return none;

  const identity = readSandboxIdentity(env);
  if (!identity) return none;
  if (!getuid || getuid() !== 0) return none;

  return {
    options: { uid: identity.uid, gid: identity.gid },
    env: {
      HOME: identity.home,
      TMPDIR: `${identity.home}/tmp`,
      UV_CACHE_DIR: `${identity.home}/.cache/uv`,
    },
  };
}

/** True when `SANDBOX_UID` or `SANDBOX_GID` is set to anything at all. */
function requested(env: Record<string, string | undefined>): boolean {
  return (env.SANDBOX_UID ?? "").trim() !== "" || (env.SANDBOX_GID ?? "").trim() !== "";
}

/** Reasons the sandbox identity cannot be honoured, in the words the operator needs. */
export function sandboxProblems(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  getuid: (() => number) | undefined
): string[] {
  if (platform === "win32" || !requested(env)) return [];

  const identity = readSandboxIdentity(env);
  if (!identity) {
    return [
      "SANDBOX_UID and SANDBOX_GID must both be set, to plain numbers, for cells to run as " +
        "an unprivileged user. Set both, or neither.",
    ];
  }
  if (identity.uid === 0 || identity.gid === 0) {
    return ["SANDBOX_UID and SANDBOX_GID must not be 0: that is root, the user cells must not run as."];
  }
  if (!getuid || getuid() !== 0) {
    return [
      `SANDBOX_UID is set, but the engine is not running as root (uid ${getuid ? getuid() : "unknown"}), ` +
        "so it could not switch a cell to that user and every cell would fail. Run the engine as " +
        "root (the Docker image does) or unset SANDBOX_UID and SANDBOX_GID.",
    ];
  }
  return [];
}

/** Things worth saying once at startup that are not reasons to refuse. */
export function sandboxWarnings(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  if (platform === "win32" && requested(env)) {
    return ["SANDBOX_UID/SANDBOX_GID are ignored on Windows: cells cannot be run as another user here."];
  }
  return [];
}

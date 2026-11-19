/**
 * Environment handed to user-authored code nodes.
 *
 * Scoping the secrets table is only half the job: a child process that
 * inherits the engine's own `process.env` can still read the database URL, the
 * JWT signing key and every other credential the server was started with. Code
 * nodes therefore get a fresh environment built from a small allow-list of
 * variables the toolchain needs, plus the secrets the node declared.
 */

/** Variables without which node/python or the OS shell misbehave. */
const PASSTHROUGH_VARS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "TZ",
];

export function buildSandboxEnv(secrets: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const name of PASSTHROUGH_VARS) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }

  return { ...env, ...secrets };
}

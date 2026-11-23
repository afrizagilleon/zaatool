/**
 * What to say when the engine is started for production on Windows.
 *
 * Windows has no way to run a cell as another user, so there a cell is a process with the
 * engine's own rights: it can read the engine's `.env` (database password, signing key) and
 * every notebook's files, and the per-owner disk quota, resource limits and process sweep
 * of the Linux image do not exist either. That is fine on a developer's machine and wrong
 * for a server people share, so the engine says so loudly. It does not refuse to start:
 * a deliberate single-user install is legitimate.
 *
 * A pure function of its inputs, so it is tested on any platform.
 */
export function windowsProductionWarnings(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>
): string[] {
  if (platform !== "win32" || env.NODE_ENV !== "production") return [];
  return [
    "NODE_ENV=production on Windows: cells are NOT sandboxed here. They run with the engine's own " +
      "rights (they can read this machine's .env and every notebook's files), and the per-user " +
      "isolation, resource limits and disk quota of the Docker image do not apply. Use Windows " +
      "only for development or a single trusted user; run shared installs from the official " +
      "Linux image (see DEPLOY.md).",
  ];
}

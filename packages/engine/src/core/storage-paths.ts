/**
 * Where a file is allowed to be.
 *
 * Every path that reaches the filesystem in this project comes from outside it: a `dir`
 * query parameter, an uploaded filename, a base64-encoded id from a listing. Each of
 * those used to be handed to `path.join(STORAGE_DIR, …)` unexamined, and `path.join`
 * resolves `..` cheerfully — `?dir=../../..` walked straight out of the storage folder.
 *
 * The rule here is containment, checked rather than assumed: resolve the candidate, then
 * confirm the result is still underneath the root. That catches `..`, absolute paths,
 * Windows drive letters and separator tricks in one test, instead of asking whether some
 * blocklist of prefixes was complete.
 */
import fs from "fs";
import path from "path";
import { trimEndChars } from "./linear-text.js";

/**
 * Characters a filename may not carry.
 *
 * Separators first — a name is one segment, never a route. The control range and the
 * Windows-reserved punctuation follow, because a file this engine happily writes on Linux
 * should not be a file that cannot be deleted on the machine it is copied to.
 */
const UNSAFE_IN_NAME = /[\u0000-\u001f<>:"/\\|?*]/g;

/** Names Windows refuses regardless of extension. */
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * A single filename, safe to write.
 *
 * Never fails: an upload arriving with a hostile name gets a dull one rather than a
 * rejection, because the person uploading usually did not choose the name and cannot fix
 * it.
 */
export function safeFilename(raw: unknown): string {
  const base = path.basename(String(raw ?? "").replace(/\\/g, "/")).replace(UNSAFE_IN_NAME, "_");
  // Leading dots hide the file; trailing dots and spaces are silently dropped by Windows,
  // which would make the name on disk differ from the name in the listing.
  const trimmed = trimEndChars(base.replace(/^\.+/, ""), ". ");
  if (trimmed.length === 0) return "file";

  const dot = trimmed.lastIndexOf(".");
  const stem = dot === -1 ? trimmed : trimmed.slice(0, dot);
  if (RESERVED_NAMES.has(stem.toLowerCase())) return `_${trimmed}`;

  // Long enough for any real name, short enough for every filesystem in use.
  return trimmed.slice(0, 180);
}

/**
 * A relative path inside the root, or `null` if it escapes.
 *
 * `null` rather than `""`: a caller that means "the root" passes nothing, and a caller
 * whose input was rejected must be able to tell the difference — silently treating
 * `../../etc` as the root would answer a hostile request with the wrong folder's contents
 * instead of a refusal.
 */
export function safeSubPath(raw: unknown, root: string): string | null {
  const value = String(raw ?? "").trim();
  if (value.length === 0) return "";

  // A leading separator would make `path.resolve` ignore the root entirely.
  const relative = value.replace(/^[/\\]+/, "");
  if (relative.length === 0) return "";
  // Absolute on either platform, and a drive-relative `C:foo` too. On Linux `C:\Windows` is
  // just an odd file name, but a path is data that moves between machines: the same input
  // must be refused everywhere, not only where the server happens to run (CI found this).
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) return null;

  const resolved = path.resolve(root, relative);
  if (!isInside(resolved, root)) return null;
  // Lexically inside is not enough: a symlink under the root can point anywhere.
  const realResolved = realpathOrAncestor(resolved);
  const realRoot = realpathOrAncestor(root);
  if (realResolved === null || realRoot === null || !isInside(realResolved, realRoot)) return null;

  return path.relative(root, resolved).replace(/\\/g, "/");
}

/** The absolute path a relative one names, or `null` if it is not underneath the root. */
export function resolveInside(raw: unknown, root: string): string | null {
  const relative = safeSubPath(raw, root);
  if (relative === null) return null;
  return relative === "" ? path.resolve(root) : path.resolve(root, relative);
}

function isInside(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  if (candidate === resolvedRoot) return true;
  return candidate.startsWith(resolvedRoot + path.sep);
}

/**
 * The real path of `target`, following symlinks. A path that does not exist yet (an upload
 * about to be written) must not throw, so the nearest existing ancestor is resolved and
 * the missing remainder is appended unchanged. A dangling symlink exists but cannot be
 * resolved, and writing through it would land wherever it points: `null`, refused.
 */
function realpathOrAncestor(target: string): string | null {
  const missing: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing.reverse());
    } catch {
      try {
        fs.lstatSync(current);
        return null;
      } catch {
        // really absent: climb
      }
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

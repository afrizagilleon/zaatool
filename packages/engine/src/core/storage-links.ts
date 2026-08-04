/**
 * Links to a stored file that carry their own permission.
 *
 * `/storage` used to be `express.static` with nothing in front of it, so every file
 * anyone had ever uploaded was readable by anything that could reach the port — and a
 * page shared with somebody who has no account still has to show its images.
 *
 * A session cookie would solve the first problem and not the second. So the permission
 * travels in the link instead: a signature over *one path* and an expiry. It cannot be
 * edited into a different path, it stops working on its own, and it is safe to hand to
 * someone who is not allowed to see anything else here.
 *
 * The signing key is derived from `JWT_SECRET` with a label rather than being a second
 * variable to set and lose. Different label, different key: a share token can never be
 * mistaken for a file signature, and neither can be turned into a session.
 */
import crypto from "crypto";
import { jwtSecret } from "../config.js";

/** How long a minted link stays good. Long enough to read a page, short enough to expire. */
export const LINK_TTL_MS = 12 * 60 * 60 * 1000;

const LABEL = "zaa-storage-link-v1";

function signingKey(): Buffer {
  return crypto.createHmac("sha256", jwtSecret()).update(LABEL).digest();
}

function signature(relativePath: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", signingKey())
    .update(`${relativePath}\n${expiresAt}`)
    .digest("base64url");
}

/**
 * A path plus the proof it may be read, ready to put in `src` or `href`.
 *
 * Relative on purpose: the caller knows whether it is building a URL for its own origin
 * or for somewhere else, and this does not.
 */
export function signStorageLink(relativePath: string, ttlMs: number = LINK_TTL_MS): string {
  const clean = relativePath.replace(/^\/+/, "");
  const expiresAt = Date.now() + ttlMs;
  const encoded = clean.split("/").map(encodeURIComponent).join("/");
  return `/storage/${encoded}?exp=${expiresAt}&sig=${signature(clean, expiresAt)}`;
}

/**
 * Whether this signature really covers this path, and has not run out.
 *
 * Compared in constant time. The comparison is not the weak point here — the expiry is
 * public and the path is guessable — but a signature check that leaks its own progress is
 * the kind of thing that gets copied into somewhere it matters.
 */
export function storageLinkValid(relativePath: string, exp: unknown, sig: unknown): boolean {
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  if (typeof sig !== "string" || sig.length === 0) return false;

  const expected = Buffer.from(signature(relativePath.replace(/^\/+/, ""), expiresAt));
  const offered = Buffer.from(sig);
  if (expected.length !== offered.length) return false;
  return crypto.timingSafeEqual(expected, offered);
}

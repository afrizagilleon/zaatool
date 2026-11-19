import path from "node:path";
import type { Request, Response, NextFunction } from "express";

/**
 * Headers for everything under `/storage`.
 *
 * Uploaded files are served from the same origin as the app — and an anonymous visitor
 * can upload one through a share link. A `.html` or `.svg` opened from its link would run
 * script with the app's origin, and the app keeps its session token in localStorage.
 *
 * Three layers, so no single one is the only thing between a file and the session:
 *  - `nosniff`: the browser may not decide a file is HTML when we said it is not.
 *  - `Content-Security-Policy: sandbox`: even a document that does render gets an opaque
 *    origin with no scripts, so it cannot read the app's storage.
 *  - `Content-Disposition: attachment` for anything not on the inline allowlist, so
 *    active content is downloaded rather than shown. `src` loads ignore disposition.
 *
 * PDFs are inline but WITHOUT `sandbox`: Chrome's built-in viewer refuses to render a
 * sandboxed PDF in the preview dialog's iframe. A PDF served with its exact type and
 * `nosniff` is not a document the browser runs in the page's origin, and its own script
 * lives in the viewer's sandbox. Everything else keeps the sandbox.
 */
const INLINE_SAFE = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico",
  ".mp4", ".webm", ".ogv", ".mov", ".m4v",
  ".mp3", ".wav", ".ogg", ".oga", ".m4a", ".flac", ".aac", ".opus",
  ".pdf", ".txt", ".csv", ".json", ".log", ".md",
]);

const SANDBOX_CSP =
  "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
const PDF_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

export function storageHeaders(req: Request, res: Response, next: NextFunction) {
  let decoded = req.path;
  try {
    decoded = decodeURIComponent(req.path);
  } catch {
    // storageAccess answers a bad path; headers are still set below.
  }
  const ext = path.extname(decoded).toLowerCase();

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", ext === ".pdf" ? PDF_CSP : SANDBOX_CSP);

  if (!INLINE_SAFE.has(ext)) {
    const base = path.posix.basename(decoded.replace(/\\/g, "/")) || "download";
    const ascii = base.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
    const encoded = encodeURIComponent(base).replace(
      /['()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
    res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
  }
  next();
}

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { STORAGE_DIR } from "./storage.service.js";
import { safeFilename, safeSubPath } from "../core/storage-paths.js";
import { signStorageLink } from "../core/storage-links.js";
import {
  fileWriteProblem,
  MAX_CELL_FILE_BYTES,
  type FileWriteRequest,
  type FileWriter,
  type StoredFile,
} from "../core/notebook-files.js";
import { maxNotebookStorageBytes } from "../config.js";
import { ContractError } from "../core/notebook-contract.js";
import { notebookAccessService } from "./notebook-access.service.js";

export function getFolderSizeRecursive(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getFolderSizeRecursive(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        total += stat.size;
      }
    }
  } catch {
    // ignore
  }
  return total;
}

export function checkNotebookStorageQuota(notebookId: string, additionalBytes: number): void {
  const folder = path.join(STORAGE_DIR, "uploads", safeFilename(notebookId) || "unknown");
  const currentSize = getFolderSizeRecursive(folder);
  if (currentSize + additionalBytes > maxNotebookStorageBytes()) {
    const maxMb = Math.round(maxNotebookStorageBytes() / (1024 * 1024));
    throw new Error(
      `Notebook storage limit of ${maxMb} MB reached. Increase MAX_NOTEBOOK_STORAGE_MB if needed.`
    );
  }
}

/**
 * Where a notebook's own files live, and where an attachment on its way in lands.
 *
 * Two folders, and the difference between them is who chose the contents:
 *
 *  - `notebooks/<id>/` — written by cells. The name is the cell's, so writing the same
 *    name twice replaces it. That is what makes `chart.png` mean *the current chart*
 *    rather than the four hundredth one, and it is why nothing here appends a timestamp.
 *  - `uploads/<notebookId>/` — arrived from outside, from a page or a webhook. A random
 *    prefix, because two people uploading `photo.jpg` are not replacing each other's.
 *
 * Neither is `dir`-addressable and neither is declared anywhere. A notebook cannot choose
 * its folder any more than it can choose its id.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".zip": "application/zip",
};

function mimeFor(name: string): string {
  return MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

/** A folder name that is definitely one segment, whatever the id turns out to be. */
function segment(value: string): string {
  return safeFilename(value) || "unknown";
}

function describe(relativePath: string, size: number): StoredFile {
  return {
    name: path.basename(relativePath),
    path: relativePath,
    url: signStorageLink(relativePath),
    size,
    mime: mimeFor(relativePath),
  };
}

export class NotebookFilesService {
  /** Everything a given notebook has written, newest last. Used by nothing yet; cheap to have. */
  folderFor(notebookId: string): string {
    return path.join(STORAGE_DIR, "notebooks", segment(notebookId));
  }

  /**
   * The writer a run hands to its cells.
   *
   * Built per run rather than imported as a singleton so the notebook's identity is
   * closed over: a cell asks for `chart.png` and cannot ask for anybody else's.
   */
  writerFor(notebookId: string): FileWriter {
    return async (request: FileWriteRequest): Promise<StoredFile> => {
      const problem = fileWriteProblem(request);
      if (problem) throw new Error(problem);

      const filename = safeFilename(request.name);
      const bytes = Buffer.from(request.data, request.encoding === "base64" ? "base64" : "utf8");

      // Checked again on the decoded bytes: the estimate before this one is a guard
      // against copying something enormous, not a limit.
      if (bytes.byteLength > MAX_CELL_FILE_BYTES) {
        throw new Error(
          `that file is ${Math.round(bytes.byteLength / (1024 * 1024))} MB, over the ` +
            `${Math.round(MAX_CELL_FILE_BYTES / (1024 * 1024))} MB a cell may write`
        );
      }

      const folder = this.folderFor(notebookId);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, filename), bytes);

      return describe(`notebooks/${segment(notebookId)}/${filename}`, bytes.byteLength);
    };
  }

  /**
   * Keeps something that arrived from outside — a page's file picker, a webhook's
   * multipart body, a voice recording.
   *
   * `source` separates a page's uploads from a hook's without either being able to name
   * the other's folder.
   */
  keepUpload(
    notebookId: string,
    originalName: string,
    bytes: Buffer,
    source: "page" | "hook" = "page"
  ): StoredFile {
    checkNotebookStorageQuota(notebookId, bytes.byteLength);

    const folder = path.join(STORAGE_DIR, "uploads", segment(notebookId));
    fs.mkdirSync(folder, { recursive: true });

    const filename = `${source}-${crypto.randomBytes(6).toString("hex")}-${safeFilename(originalName)}`;
    fs.writeFileSync(path.join(folder, filename), bytes);

    return describe(`uploads/${segment(notebookId)}/${filename}`, bytes.byteLength);
  }

  /**
   * Decides which of a run's file inputs the cell may be given, and drops what a caller
   * dressed them up with.
   *
   * `bindInputs` only proves a path is inside storage, and storage holds every notebook's
   * folder: without this, an `args` value of `notebooks/<somebody else's id>/report.csv`
   * from a page's visitor would have been read for them. A path is admitted when
   *
   *  - it was already admitted earlier in this chain of runs (`grants`: an input some run
   *    was allowed, or a file some notebook wrote), or
   *  - it lies under `uploads/<id>/` or `notebooks/<id>/` of the notebook being run (a page
   *    visitor who can only *use* a notebook uploads into its folder), unless `ownFolders` is
   *    off (a nested call: the caller's code chose the path, and a callee's folder is not
   *    the caller's to name), or
   *  - it is not hidden from the actor, who is whoever started the run, or the notebook's
   *    owner when nobody did (cron, webhook, share link) — and for a nested call, the owner
   *    of the notebook whose cell made the call.
   *
   * Anything else is refused with the words used for a file that is not there, so a refusal
   * tells a visitor nothing about which files exist. Every admitted path is added to `grants`,
   * which is what lets the runner copy it into the cell's folder (and nothing else).
   *
   * `absolute_path` never survives: a cell no longer reads a server path, it reads its copy.
   */
  async admitInputFiles(
    params: { name: string; type: string }[] | undefined,
    bound: Record<string, unknown>,
    context: { notebookId: string; actorId: string | null; ownFolders: boolean; grants: Set<string> }
  ): Promise<Record<string, unknown>> {
    if (!Array.isArray(params)) return bound;

    const fileParams = params.filter((param) => param?.type === "file");
    if (fileParams.length === 0) return bound;

    // Asked once per run, not once per file.
    const hidden =
      context.actorId === null
        ? (relative: string): boolean => {
            const [top, id] = relative.split("/");
            return (top === "notebooks" || top === "uploads") && id !== undefined;
          }
        : await notebookAccessService.hiddenFromStorage(context.actorId);

    const own = segment(context.notebookId);
    const enriched = { ...bound };
    const issues: string[] = [];

    for (const param of fileParams) {
      const value = enriched[param.name] as { path?: string } | undefined;
      if (!value || typeof value !== "object") continue;

      const { absolute_path: _ignored, ...rest } = value as Record<string, unknown>;
      enriched[param.name] = rest;

      const relative = typeof value.path === "string" ? safeSubPath(value.path, STORAGE_DIR) : null;
      if (relative === null || relative === "") continue;

      const inOwnFolder =
        context.ownFolders && (relative.startsWith(`uploads/${own}/`) || relative.startsWith(`notebooks/${own}/`));
      const allowed = context.grants.has(relative) || inOwnFolder || !hidden(relative);

      if (!allowed || !isFile(path.join(STORAGE_DIR, relative))) {
        issues.push(`"${param.name}": file not found`);
        continue;
      }
      context.grants.add(relative);
    }

    if (issues.length > 0) throw new ContractError(issues);
    return enriched;
  }
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

export const notebookFilesService = new NotebookFilesService();

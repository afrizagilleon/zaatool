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
    const folder = path.join(STORAGE_DIR, "uploads", segment(notebookId));
    fs.mkdirSync(folder, { recursive: true });

    const filename = `${source}-${crypto.randomBytes(6).toString("hex")}-${safeFilename(originalName)}`;
    fs.writeFileSync(path.join(folder, filename), bytes);

    return describe(`uploads/${segment(notebookId)}/${filename}`, bytes.byteLength);
  }

  /** The absolute path of a stored file, for a cell that wants to read one it was given. */
  absolutePathOf(relativePath: string): string {
    return path.join(STORAGE_DIR, relativePath);
  }

  /**
   * Adds the one field a cell needs and nothing else may see.
   *
   * A cell reads a file off this machine's disk, so it needs a real path. That path names
   * the server's filesystem, so it is added here — on the way *in*, to bound arguments
   * only — and never put in a descriptor that a page, a webhook reply or an agent will
   * read back.
   */
  withReadablePaths(
    params: { name: string; type: string }[] | undefined,
    bound: Record<string, unknown>
  ): Record<string, unknown> {
    if (!Array.isArray(params)) return bound;

    const enriched = { ...bound };
    for (const param of params) {
      if (param?.type !== "file") continue;
      const value = enriched[param.name] as { path?: string } | undefined;
      if (!value || typeof value.path !== "string") continue;

      const relative = safeSubPath(value.path, STORAGE_DIR);
      if (relative === null || relative === "") continue;

      enriched[param.name] = { ...value, absolute_path: this.absolutePathOf(relative) };
    }
    return enriched;
  }
}

export const notebookFilesService = new NotebookFilesService();

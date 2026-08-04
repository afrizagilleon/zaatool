/**
 * The channel a running cell uses to keep a file.
 *
 * The second hole in the same wall `notebook-call.ts` opened, and deliberately the same
 * shape: a cell asks, the engine writes, only JSON crosses. A worker thread could reach
 * `fs` directly today, but a Python child cannot, and a rule that holds for one runtime
 * and not the other is not a rule. More to the point, the *engine* is the only side that
 * knows where files may land, what a safe name is, and how to sign a link to one.
 *
 * What comes back is what a page can already render. `render: image` and `render: file`
 * were in the vocabulary long before anything could produce a value for them; this is the
 * missing half.
 */

/** The written file, as the cell sees it and as an output may carry it. */
export interface StoredFile {
  name: string;
  /** Relative to the storage root, and the id the rest of the system uses. */
  path: string;
  /** Signed and time-limited — the only form in which a file is readable. */
  url: string;
  size: number;
  mime: string;
}

export interface FileWriteRequest {
  name: string;
  /**
   * The bytes, as text.
   *
   * `base64` for anything that is not text, which is most of what is worth writing —
   * a chart, a photo, a spreadsheet. Chosen rather than a Buffer because this frame is
   * JSON: the Python child and the JavaScript worker send the same thing.
   */
  data: string;
  encoding?: "utf8" | "base64";
}

/**
 * Writes one file and answers with what it became.
 *
 * Rejects rather than returning an error shape: from inside a cell this is an ordinary
 * `await`, and a failure to write should stop the cell the way any other failure does.
 */
export type FileWriter = (request: FileWriteRequest) => Promise<StoredFile>;

/** Bytes a single cell may write in one file. Generous for a chart, hopeless for a dump. */
export const MAX_CELL_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Checks a request before it reaches the disk.
 *
 * Here rather than in the writer because both runners have to answer the cell, and the
 * cheapest place to refuse something is before it has been copied twice.
 */
export function fileWriteProblem(request: FileWriteRequest): string | null {
  if (typeof request.name !== "string" || request.name.trim() === "") {
    return "files.write needs a name";
  }
  if (typeof request.data !== "string") {
    return "files.write needs its data as a string — base64 for anything that is not text";
  }
  if (request.encoding !== undefined && request.encoding !== "utf8" && request.encoding !== "base64") {
    return `encoding must be "utf8" or "base64", not ${JSON.stringify(request.encoding)}`;
  }
  // Rough: base64 is 4 characters per 3 bytes. Exact size is checked after decoding.
  const approximateBytes = request.encoding === "base64" ? (request.data.length * 3) / 4 : request.data.length;
  if (approximateBytes > MAX_CELL_FILE_BYTES) {
    return `that file is larger than the ${Math.round(MAX_CELL_FILE_BYTES / (1024 * 1024))} MB a cell may write`;
  }
  return null;
}

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The storage folder. Defined in core so the runners and the contract can name it without
 * importing from services; `services/storage.service.ts` re-exports it for everyone else.
 */
export const STORAGE_DIR = path.resolve(__dirname, "../../../storage");

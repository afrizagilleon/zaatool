import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import fs from "fs";
import { storageController } from "../controllers/storage.controller.js";
import { STORAGE_DIR } from "../services/storage.service.js";
import { resolveInside, safeFilename } from "../core/storage-paths.js";
import { requireRole } from "../middleware/require-role.js";
import { notebookAccessService } from "../services/notebook-access.service.js";
import { maxUploadBytes } from "../config.js";

/**
 * Where an upload lands, decided here rather than by the request.
 *
 * It used to be `path.join(STORAGE_DIR, req.query.dir)` with the filename taken verbatim,
 * which is two holes in one line: `?dir=../../..` chose the folder and a name like
 * `../../server.js` chose the file. Both are now resolved and checked against the root
 * before anything is written, and a rejected `dir` fails the request instead of quietly
 * landing somewhere else.
 */
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const targetDir = resolveInside(req.query.dir, STORAGE_DIR);
    if (targetDir === null) {
      return cb(new Error("That folder is outside storage."), "");
    }
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (_req, file, cb) => {
    cb(null, safeFilename(file.originalname));
  },
});

const upload = multer({ storage, limits: { fileSize: maxUploadBytes(), files: 1 } });

/**
 * Multer's refusals arrive as errors, not as responses.
 *
 * Without this the size limit produces a 500 with a stack trace in the log and nothing
 * useful on screen — a limit nobody can tell they hit is a limit that gets reported as a
 * bug.
 */
/**
 * Before multer writes anything: a file must not land in a folder that belongs to a notebook
 * the caller cannot edit. Multer decides the destination from `?dir=` on its own, so this has
 * to be asked first, and answered as if the folder were not there.
 */
async function notSomeoneElsesFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as Request & { user: { id: string } }).user;
    const hidden = await notebookAccessService.hiddenFromStorage(user.id);
    if (hidden(String(req.query.dir ?? ""))) return res.status(404).json({ error: "Not found" });
    next();
  } catch (err) {
    next(err);
  }
}

function uploadOne(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `That file is larger than the ${Math.round(maxUploadBytes() / (1024 * 1024))} MB limit.`,
      });
    }
    res.status(400).json({ error: (err as Error).message });
  });
}

export const storageRouter = Router();
const creator = requireRole("creator");

storageRouter.get("/files", storageController.getAll);
storageRouter.post("/files", creator, notSomeoneElsesFolder, uploadOne, storageController.uploadFile);
storageRouter.patch("/files/:id", creator, storageController.renameItem);
storageRouter.delete("/files/:id", creator, storageController.deleteItem);
storageRouter.post("/folders", creator, storageController.createFolder);

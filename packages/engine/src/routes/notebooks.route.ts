import { Router } from "express";
import multer from "multer";
import { NotebooksController } from "../controllers/notebooks.controller.js";
import { requireRole } from "../middleware/require-role.js";
import { maxUploadBytes } from "../config.js";
import type { RunEventSink } from "../core/run-emitter.js";

/**
 * An attachment on its way into a run.
 *
 * In memory, never on disk here: where it lands is `notebookFilesService`'s decision, and
 * a `dir` this route could be talked into is exactly the hole M18 closed. One file, size
 * limited, and the name is treated as a suggestion.
 */
const attachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes(), files: 1 },
});

/**
 * Built as a factory because running a notebook needs the run event sink, which
 * is wired at the composition root rather than imported as a singleton.
 *
 * The line between the two roles falls here, and it falls in one place: **changing what
 * exists needs a creator; asking it to work does not.** A viewer opens Apps, presses Run,
 * presses a button, reads the history. A viewer cannot write a cell, deploy a version,
 * mint a share link, or erase a record of what happened.
 */
export function createNotebooksRouter(publishRunEvent: RunEventSink): Router {
  const router = Router();
  const controller = new NotebooksController(publishRunEvent);
  const creator = requireRole("creator");

  router.get("/", controller.list);
  router.post("/", creator, controller.save);
  // Before `/:id`, or "map" would be read as a notebook id.
  router.get("/map", controller.map);
  router.get("/pages", controller.pages);
  // Before `/:id` for the same reason `map` is.
  router.post("/text", creator, controller.saveText);
  router.get("/:id/text", controller.text);
  router.get("/:id", controller.getById);
  router.delete("/:id", creator, controller.remove);
  router.post("/:id/duplicate", creator, controller.duplicate);
  router.post("/:id/run", controller.run);
  // Not creator-only, unlike the resources library. Running a page is a viewer's whole
  // purpose, and a page that asks for a photo cannot be run without giving it one. What
  // arrives here lands in the notebook's own uploads folder, never in the shared files.
  router.post("/:id/uploads", attachment.single("file"), controller.upload);
  router.post("/:id/actions/:index", controller.runAction);
  router.get("/:id/deploy", controller.deployState);
  router.get("/:id/deployed", controller.deployedDocument);
  router.post("/:id/deploy", creator, controller.deploy);
  router.delete("/:id/deploy", creator, controller.undeploy);
  router.get("/:id/shares", creator, controller.listShares);
  router.post("/:id/shares", creator, controller.createShare);
  router.delete("/:id/shares/:shareId", creator, controller.revokeShare);
  router.get("/:id/runs", controller.listRuns);
  router.delete("/:id/runs", creator, controller.clearRuns);
  router.get("/:id/runs/:runId", controller.getRun);
  router.post("/:id/runs/:runId/cancel", creator, controller.cancelRun);

  return router;
}

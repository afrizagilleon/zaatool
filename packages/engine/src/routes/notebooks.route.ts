import { Router } from "express";
import { NotebooksController } from "../controllers/notebooks.controller.js";
import { requireRole } from "../middleware/require-role.js";
import type { RunEventSink } from "../core/run-emitter.js";

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
  router.get("/:id", controller.getById);
  router.delete("/:id", creator, controller.remove);
  router.post("/:id/run", controller.run);
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

  return router;
}

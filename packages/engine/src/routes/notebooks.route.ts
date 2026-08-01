import { Router } from "express";
import { NotebooksController } from "../controllers/notebooks.controller.js";
import type { RunEventSink } from "../core/run-emitter.js";

/**
 * Built as a factory because running a notebook needs the run event sink, which
 * is wired at the composition root rather than imported as a singleton.
 */
export function createNotebooksRouter(publishRunEvent: RunEventSink): Router {
  const router = Router();
  const controller = new NotebooksController(publishRunEvent);

  router.get("/", controller.list);
  router.post("/", controller.save);
  // Before `/:id`, or "map" would be read as a notebook id.
  router.get("/map", controller.map);
  router.get("/:id", controller.getById);
  router.delete("/:id", controller.remove);
  router.post("/:id/run", controller.run);
  router.get("/:id/runs", controller.listRuns);
  router.delete("/:id/runs", controller.clearRuns);
  router.get("/:id/runs/:runId", controller.getRun);

  return router;
}

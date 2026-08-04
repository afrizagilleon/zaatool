import { Router } from "express";
import { secretsController } from "../controllers/secrets.controller.js";
import { requireRole } from "../middleware/require-role.js";

export const secretsRouter = Router();

// Creator-only end to end, including the listing. A secret's *name* is how a notebook
// reaches it, so the list of names is the map of what this installation can touch —
// which bank, which API, which mailbox. That is not a viewer's business either.
secretsRouter.use(requireRole("creator"));

secretsRouter.get("/", secretsController.getAll);
secretsRouter.post("/", secretsController.create);
secretsRouter.put("/:id", secretsController.update);
secretsRouter.delete("/:id", secretsController.delete);

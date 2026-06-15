import { Router } from "express";
import { secretsController } from "../controllers/secrets.controller.js";

export const secretsRouter = Router();

secretsRouter.get("/", secretsController.getAll);
secretsRouter.post("/", secretsController.create);
secretsRouter.put("/:id", secretsController.update);
secretsRouter.delete("/:id", secretsController.delete);

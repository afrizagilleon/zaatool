import { Router } from "express";
import { triggersController } from "../controllers/triggers.controller.js";

export const triggersRouter = Router();

triggersRouter.get("/flow/:flowId", triggersController.getByFlowId);
triggersRouter.post("/", triggersController.save);
triggersRouter.delete("/:id", triggersController.delete);

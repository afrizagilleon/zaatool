import { Router } from "express";
import { flowsController } from "../controllers/flows.controller.js";

export const flowsRouter = Router();

flowsRouter.get("/", flowsController.getSummary);
flowsRouter.get("/detail", flowsController.getAll); // Fallback to list detailed flows
flowsRouter.get("/:id", flowsController.getById);
flowsRouter.post("/", flowsController.save);
flowsRouter.delete("/:id", flowsController.delete);

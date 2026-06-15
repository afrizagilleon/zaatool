import { Router } from "express";
import { skillsController } from "../controllers/skills.controller.js";

export const skillsRouter = Router();

skillsRouter.get("/", skillsController.getAll);
skillsRouter.post("/", skillsController.create);
skillsRouter.put("/:id", skillsController.update);
skillsRouter.delete("/:id", skillsController.delete);

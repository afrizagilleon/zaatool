import { Router } from "express";
import { skillsController } from "../controllers/skills.controller.js";
import { renderConventions } from "../mcp/conventions.js";

export const skillsRouter = Router();

// What an agent actually reads: the notebook format reference followed by these
// skills. Before `/:id`, or "conventions" would be read as a skill id.
skillsRouter.get("/conventions", async (_req, res) => {
  res.json({ text: await renderConventions(), uri: "zaa://conventions" });
});

skillsRouter.get("/", skillsController.getAll);
skillsRouter.post("/", skillsController.create);
skillsRouter.put("/:id", skillsController.update);
skillsRouter.delete("/:id", skillsController.delete);

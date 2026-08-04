import { Router } from "express";
import { skillsController } from "../controllers/skills.controller.js";
import { requireRole } from "../middleware/require-role.js";
import { renderConventions } from "../mcp/conventions.js";

export const skillsRouter = Router();
const creator = requireRole("creator");

// What an agent actually reads: the notebook format reference followed by these
// skills. Before `/:id`, or "conventions" would be read as a skill id.
skillsRouter.get("/conventions", async (_req, res) => {
  res.json({ text: await renderConventions(), uri: "zaa://conventions" });
});

skillsRouter.get("/", skillsController.getAll);
skillsRouter.post("/", creator, skillsController.create);
skillsRouter.put("/:id", creator, skillsController.update);
skillsRouter.delete("/:id", creator, skillsController.delete);

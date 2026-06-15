import { Router } from "express";
import { aiController } from "../controllers/ai.controller.js";

export const aiRouter = Router();

aiRouter.post("/generate", aiController.generate);

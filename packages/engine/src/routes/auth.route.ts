import { Router } from "express";
import { authController } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/require-role.js";

export const authRouter = Router();

authRouter.get("/policy", authController.policy);
authRouter.post("/register", authController.register);
authRouter.post("/login", authController.login);
authRouter.get("/me", authMiddleware, authController.getMe);

// Once the door is shut, this is how anyone else gets in.
authRouter.get("/users", authMiddleware, requireRole("creator"), authController.listUsers);
authRouter.post("/users", authMiddleware, requireRole("creator"), authController.inviteUser);
authRouter.patch("/users/:id", authMiddleware, requireRole("creator"), authController.setActive);


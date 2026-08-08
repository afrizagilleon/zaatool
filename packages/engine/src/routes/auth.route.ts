import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authController } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/require-role.js";
import { loginRateLimitWindowMs, loginRateLimitMax } from "../config.js";

export const loginLimiter = rateLimit({
  windowMs: loginRateLimitWindowMs(),
  limit: () => loginRateLimitMax(),
  message: { error: "Too many login attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.get("/policy", authController.policy);
authRouter.post("/register", authController.register);
authRouter.post("/login", loginLimiter, authController.login);
authRouter.get("/me", authMiddleware, authController.getMe);
authRouter.post("/me/password", authMiddleware, authController.changePassword);



// Once the door is shut, this is how anyone else gets in.
authRouter.get("/users", authMiddleware, requireRole("creator"), authController.listUsers);
authRouter.post("/users", authMiddleware, requireRole("creator"), authController.inviteUser);
authRouter.patch("/users/:id", authMiddleware, requireRole("creator"), authController.setActive);


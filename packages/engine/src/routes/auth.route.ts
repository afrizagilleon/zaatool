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

/**
 * Registration gets a limiter of its own, with the login settings. While there are no
 * accounts it is the door to the whole installation and the setup code is what guards it,
 * so guessing it must be as expensive as guessing a password. Separate from `loginLimiter`
 * so that a person fumbling a password does not lock themselves out of signing up.
 */
export const registerLimiter = rateLimit({
  windowMs: loginRateLimitWindowMs(),
  limit: () => loginRateLimitMax(),
  message: { error: "Too many registration attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.get("/policy", authController.policy);
authRouter.post("/register", registerLimiter, authController.register);
authRouter.post("/login", loginLimiter, authController.login);
authRouter.post("/logout", authController.logout);
authRouter.get("/me", authMiddleware, authController.getMe);
authRouter.post("/me/password", authMiddleware, authController.changePassword);
authRouter.post("/logout-all", authMiddleware, authController.logoutAll);



// Once the door is shut, this is how anyone else gets in.
authRouter.get("/users", authMiddleware, requireRole("creator"), authController.listUsers);
authRouter.post("/users", authMiddleware, requireRole("creator"), authController.inviteUser);
authRouter.patch("/users/:id", authMiddleware, requireRole("creator"), authController.setActive);


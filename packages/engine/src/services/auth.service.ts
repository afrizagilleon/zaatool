import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db/connection.js";
import { jwtSecret, registrationOpen } from "../config.js";

const SALT_ROUNDS = 10;

/**
 * The two things a person can be here.
 *
 * `creator` writes, deploys, holds secrets and uploads. `viewer` opens Apps and presses
 * Run. There is deliberately no third: a role only earns its place when something checks
 * it, and everything this project needs to protect falls on one side of that line.
 */
export const ROLES = ["creator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export class RegistrationClosedError extends Error {
  constructor() {
    super(
      "Registration is closed. Ask someone with a creator account to invite you, or set " +
        "ALLOW_REGISTRATION=true on the engine."
    );
    this.name = "RegistrationClosedError";
  }
}

export class AuthService {
  /** How many accounts exist — the one question that decides whether the door is open. */
  async userCount(): Promise<number> {
    const { rows } = await pool.query("SELECT COUNT(*) FROM users");
    return parseInt(rows[0].count, 10);
  }

  /**
   * Sign-up from the login screen.
   *
   * Open in exactly one case that cannot be configured away: an installation with no
   * users at all. Somebody has to be able to get in the first time, and that person is
   * the creator. After that the door is shut unless it was deliberately propped open.
   */
  async register(username: string, passwordPlain: string, email?: string) {
    const existingUsers = await this.userCount();
    if (existingUsers > 0 && !registrationOpen()) {
      throw new RegistrationClosedError();
    }

    return this.createUser(username, passwordPlain, existingUsers === 0 ? "creator" : "viewer", email);
  }

  /**
   * An account made by someone who already has one.
   *
   * Separate from {@link register} because the caller, not the count, decides the role —
   * and because the route above it is the thing that checks the caller is a creator.
   */
  async createUser(username: string, passwordPlain: string, role: Role, email?: string) {
    const name = String(username ?? "").trim();
    if (name.length === 0) throw new Error("Username is required");
    if (String(passwordPlain ?? "").length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [name]);
    if (existing.rows.length > 0) {
      throw new Error("Username already taken");
    }

    const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
    const userId = uuidv4();

    await pool.query(
      `INSERT INTO users (id, username, password_hash, email, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, name, passwordHash, email || null, role]
    );

    return { id: userId, username: name, email, role };
  }

  async login(username: string, passwordPlain: string) {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

    if (rows.length === 0) {
      throw new Error("Invalid username or password");
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(passwordPlain, user.password_hash);
    if (!isPasswordValid) {
      throw new Error("Invalid username or password");
    }

    const role: Role = isRole(user.role) ? user.role : "viewer";

    const token = jwt.sign({ id: user.id, username: user.username, role }, jwtSecret(), {
      expiresIn: "24h",
    });

    return {
      token,
      user: { id: user.id, username: user.username, email: user.email, role },
    };
  }

  /** Replaces a password outright. Used by the terminal reset; there is no email path. */
  async setPassword(username: string, passwordPlain: string): Promise<boolean> {
    if (String(passwordPlain ?? "").length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
    const { rowCount } = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE username = $2",
      [passwordHash, username]
    );
    return (rowCount ?? 0) > 0;
  }

  async setRole(username: string, role: Role): Promise<boolean> {
    const { rowCount } = await pool.query("UPDATE users SET role = $1 WHERE username = $2", [
      role,
      username,
    ]);
    return (rowCount ?? 0) > 0;
  }

  async listUsers() {
    const { rows } = await pool.query(
      "SELECT id, username, email, role, created_at FROM users ORDER BY created_at ASC"
    );
    return rows;
  }

  verifyToken(token: string) {
    try {
      const decoded = jwt.verify(token, jwtSecret()) as {
        id: string;
        username: string;
        role?: string;
      };
      // A token minted before roles were checked carries whatever was there, or nothing.
      // The safe reading of "no role" is the one that can do least.
      return { ...decoded, role: isRole(decoded.role) ? decoded.role : ("viewer" as Role) };
    } catch {
      return null;
    }
  }
}

export const authService = new AuthService();

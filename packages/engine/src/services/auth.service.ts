import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { ROLES, type Role } from "@zaa-tool/shared";
import { pool } from "../db/connection.js";
import { jwtSecret, registrationOpen } from "../config.js";

const SALT_ROUNDS = 10;
export const MIN_PASSWORD_LENGTH = 12;

export { ROLES, type Role };


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
    if (String(passwordPlain ?? "").length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [name]);
    if (existing.rows.length > 0) {
      throw new Error("Username already taken");
    }

    const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
    const userId = uuidv4();

    await pool.query(
      `INSERT INTO users (id, username, password_hash, email, role, active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [userId, name, passwordHash, email || null, role]
    );

    return { id: userId, username: name, email, role, active: true };
  }

  async currentUser(id: string): Promise<{ id: string; username: string; email: string | null; role: Role; active: boolean } | null> {
    const { rows } = await pool.query(
      "SELECT id, username, email, role, active FROM users WHERE id = $1",
      [id]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      username: r.username,
      email: r.email,
      role: isRole(r.role) ? r.role : "viewer",
      active: r.active ?? true,
    };
  }

  async setActive(id: string, active: boolean): Promise<boolean> {
    const { rowCount } = await pool.query(
      "UPDATE users SET active = $1 WHERE id = $2",
      [active, id]
    );
    return (rowCount ?? 0) > 0;
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

    if (user.active === false) {
      throw new Error("This account has been deactivated.");
    }

    const role: Role = isRole(user.role) ? user.role : "viewer";

    const token = jwt.sign({ id: user.id, username: user.username, role }, jwtSecret(), {
      expiresIn: "24h",
    });

    return {
      token,
      user: { id: user.id, username: user.username, email: user.email, role, active: user.active ?? true },
    };
  }

  /** Replaces a password outright. Used by the terminal reset; there is no email path. */
  async setPassword(username: string, passwordPlain: string): Promise<boolean> {
    if (String(passwordPlain ?? "").length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
    const { rowCount } = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE username = $2",
      [passwordHash, username]
    );
    return (rowCount ?? 0) > 0;
  }

  async changePassword(userId: string, currentPasswordPlain: string, newPasswordPlain: string): Promise<boolean> {
    if (String(newPasswordPlain ?? "").length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (rows.length === 0) {
      throw new Error("User not found");
    }
    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(currentPasswordPlain, user.password_hash);
    if (!isPasswordValid) {
      throw new Error("Current password is incorrect");
    }
    const passwordHash = await bcrypt.hash(newPasswordPlain, SALT_ROUNDS);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
    return true;
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
      "SELECT id, username, email, role, active, created_at FROM users ORDER BY created_at ASC"
    );
    // `createdAt`, not `created_at`: the shape a caller receives is the one
    // `AccountUser` in `@zaa-tool/shared` describes, and the column name stops at this
    // boundary. It shipped once as `created_at` against a type that promised
    // `createdAt` — nothing broke, because nothing read it yet, which is the worst kind
    // of nothing.
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      role: isRole(r.role) ? r.role : ("viewer" as Role),
      active: r.active ?? true,
      createdAt: new Date(r.created_at).toISOString(),
    }));
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

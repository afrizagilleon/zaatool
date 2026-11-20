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

/**
 * An error whose message was written for the person reading it.
 *
 * Since FX10 a controller may not forward `err.message` to a client blindly — a driver
 * saying `getaddrinfo ENOTFOUND postgres` on the login screen is how an attacker learns
 * the shape of the deployment. But "Password must be at least 12 characters" is the
 * entire point of the response, and replacing it with "Something went wrong" would leave
 * a person retyping a password with no idea what is wrong with it.
 *
 * The type is what tells those two apart. Matching on message text instead was tried and
 * had two clauses that could never fire on the day it was written, which is the failure
 * mode of that approach in one sentence: the string in the service and the string in the
 * controller drift, nothing type-checks the pair, and a validation message quietly turns
 * into a 500 months later.
 *
 * Anything thrown that is *not* one of these is treated as ours to fix, logged in full
 * and shown to the client as nothing at all.
 */
export class AuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthInputError";
  }
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

/**
 * What a session token amounts to once it has been checked against the account behind it.
 *
 * `inactive` is kept apart from `revoked` because the two are told to the caller
 * differently — a deactivated account is a 403 with a sentence, a dead session is a plain 401
 * — and because the first has always been that way.
 */
export type SessionCheck =
  | { status: "ok"; user: { id: string; username: string; role: Role } }
  | { status: "invalid" }
  | { status: "gone" }
  | { status: "inactive" }
  | { status: "revoked" };

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
    if (name.length === 0) throw new AuthInputError("Username is required");
    if (String(passwordPlain ?? "").length < MIN_PASSWORD_LENGTH) {
      throw new AuthInputError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [name]);
    if (existing.rows.length > 0) {
      throw new AuthInputError("Username already taken");
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

  async currentUser(
    id: string
  ): Promise<{
    id: string;
    username: string;
    email: string | null;
    role: Role;
    active: boolean;
    tokenVersion: number;
  } | null> {
    const { rows } = await pool.query(
      "SELECT id, username, email, role, active, token_version FROM users WHERE id = $1",
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
      tokenVersion: r.token_version ?? 0,
    };
  }

  /**
   * Switches an account on or off.
   *
   * Switching it off also ends every session it had. The `active` check alone would stop
   * them for as long as the account stayed off, and then hand them all back the day it was
   * switched on again — a token minted a month ago working again is not what "deactivated"
   * promised anyone.
   */
  async setActive(id: string, active: boolean): Promise<boolean> {
    const { rowCount } = await pool.query(
      active
        ? "UPDATE users SET active = true WHERE id = $1"
        : "UPDATE users SET active = false, token_version = token_version + 1 WHERE id = $1",
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  /** Ends every session this account has, on every device, by outdating their tokens. */
  async revokeSessions(id: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Signs a session token. The `tv` claim is the account's `token_version` at the moment of
   * signing; {@link authenticate} refuses the token once the account has moved past it.
   */
  signSession(user: { id: string; username: string; role: Role; tokenVersion: number }): string {
    return jwt.sign(
      { id: user.id, username: user.username, role: user.role, tv: user.tokenVersion },
      jwtSecret(),
      { expiresIn: "24h" }
    );
  }

  /**
   * A fresh token for an account as it is right now. Used when something that just ended
   * every session (a password change) should not also end the one that asked for it.
   */
  async reissueSession(id: string): Promise<string | null> {
    const current = await this.currentUser(id);
    return current ? this.signSession(current) : null;
  }

  /**
   * Turns a token into a person, or says why not.
   *
   * The token proves it was signed here; the database says whether it still counts. The
   * order is the one callers already relied on — an account that is gone is a 401, one that
   * is switched off is a 403 with its own sentence — and only after those does the version
   * decide whether a session was ended on purpose.
   */
  async authenticate(token: string): Promise<SessionCheck> {
    const decoded = this.verifyToken(token);
    if (!decoded) return { status: "invalid" };

    const current = await this.currentUser(decoded.id);
    if (!current) return { status: "gone" };
    if (current.active === false) return { status: "inactive" };
    if (decoded.tv !== current.tokenVersion) return { status: "revoked" };

    return { status: "ok", user: { id: current.id, username: current.username, role: current.role } };
  }

  async login(username: string, passwordPlain: string) {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

    if (rows.length === 0) {
      throw new AuthInputError("Invalid username or password");
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(passwordPlain, user.password_hash);
    if (!isPasswordValid) {
      throw new AuthInputError("Invalid username or password");
    }

    if (user.active === false) {
      throw new AuthInputError("This account has been deactivated.");
    }

    const role: Role = isRole(user.role) ? user.role : "viewer";

    const token = this.signSession({
      id: user.id,
      username: user.username,
      role,
      tokenVersion: user.token_version ?? 0,
    });

    return {
      token,
      user: { id: user.id, username: user.username, email: user.email, role, active: user.active ?? true },
    };
  }

  /**
   * Replaces a password outright. Used by the terminal reset; there is no email path.
   *
   * Also ends every session: the reset exists for the case where somebody else may have
   * the old password, and a session they already hold would outlive the thing it was
   * obtained with.
   */
  async setPassword(username: string, passwordPlain: string): Promise<boolean> {
    if (String(passwordPlain ?? "").length < MIN_PASSWORD_LENGTH) {
      throw new AuthInputError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
    const { rowCount } = await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE username = $2",
      [passwordHash, username]
    );
    return (rowCount ?? 0) > 0;
  }

  async changePassword(userId: string, currentPasswordPlain: string, newPasswordPlain: string): Promise<boolean> {
    if (String(newPasswordPlain ?? "").length < MIN_PASSWORD_LENGTH) {
      throw new AuthInputError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (rows.length === 0) {
      throw new AuthInputError("User not found");
    }
    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(currentPasswordPlain, user.password_hash);
    if (!isPasswordValid) {
      throw new AuthInputError("Current password is incorrect");
    }
    const passwordHash = await bcrypt.hash(newPasswordPlain, SALT_ROUNDS);
    // The version moves with the password: a stolen session should not survive the very
    // action a person takes to get rid of it.
    await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
      [passwordHash, userId]
    );
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
        tv?: number;
      };
      // A token minted before roles were checked carries whatever was there, or nothing.
      // The safe reading of "no role" is the one that can do least. A token minted before
      // versions existed has none, and an account that has never been revoked is at 0.
      return {
        ...decoded,
        role: isRole(decoded.role) ? decoded.role : ("viewer" as Role),
        tv: typeof decoded.tv === "number" ? decoded.tv : 0,
      };
    } catch {
      return null;
    }
  }
}

export const authService = new AuthService();

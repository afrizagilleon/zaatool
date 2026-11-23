import bcrypt from "bcrypt";
import type { PoolClient } from "pg";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { ROLES, type Role } from "@zaa-tool/shared";
import { pool } from "../db/connection.js";
import { jwtSecret, registrationOpen, setupCodeOverride } from "../config.js";
import { notifySessionsEnded } from "../core/session-events.js";
import { LOCK_KEYS, lockUntilTransactionEnds } from "../core/advisory-locks.js";
import type { Actor } from "../core/actor.js";
import { audit, type AuditTarget } from "./audit.service.js";

const SALT_ROUNDS = 10;

/** An account as the audit trail names it: owned by itself, so the person can see what happened to them. */
function userTarget(user: { id: string; username: string }): AuditTarget {
  return { type: "user", id: user.id, ownerId: user.id, name: user.username };
}

/**
 * The name somebody typed into a sign-in form, for the audit trail. Capped, and kept only as
 * data: a person who fumbles the password into the username field leaves it in a row only a
 * creator (or the database owner) can read, which is why failed sign-ins are never shown to
 * anyone else.
 */
function attemptedName(username: unknown): string {
  return String(username ?? "").trim().slice(0, 64);
}
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

/** The `users.username` unique index refusing a second account of the same name. */
function translateDuplicateUsername(err: unknown): AuthInputError | null {
  const { code, constraint } = err as { code?: string; constraint?: string };
  return code === "23505" && (constraint ?? "").startsWith("users_username")
    ? new AuthInputError("Username already taken")
    : null;
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
 * The first account was asked for without the setup code, or with the wrong one.
 *
 * The message names where the code is, because the person reading it is the owner of a
 * server they have just deployed and the log is the one place only they can look.
 */
export class SetupCodeError extends Error {
  constructor() {
    super(
      "A setup code is required to create the first account. The server printed one to its " +
        "log when it started: run `docker compose logs engine | grep -i setup` on the server " +
        "and enter that code."
    );
    this.name = "SetupCodeError";
  }
}

/** Letters and digits with nothing that reads as another (no 0/O, 1/I). 32 symbols, 5 bits each. */
const SETUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SETUP_CODE_GROUPS = 6;
const SETUP_CODE_GROUP_LENGTH = 5;

/** Six groups of five: 30 symbols, 150 bits. Drawn with `randomInt`, which is uniform. */
function makeSetupCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < SETUP_CODE_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < SETUP_CODE_GROUP_LENGTH; i++) {
      group += SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/** Held in memory only: a restart makes a new one, and nothing on disk ever contains it. */
let generatedSetupCode: string | null = null;

/**
 * What a first registration has to present, while there are no accounts.
 *
 * The operator's `SETUP_CODE` wins; otherwise a random code made on first use. It is the
 * proof that whoever is registering can read this server's log — and so is its owner —
 * rather than whoever happened to open the URL first.
 */
export function currentSetupCode(): { code: string; chosen: boolean } {
  const chosen = setupCodeOverride();
  if (chosen) return { code: chosen, chosen: true };
  if (!generatedSetupCode) generatedSetupCode = makeSetupCode();
  return { code: generatedSetupCode, chosen: false };
}

/** Compared as digests, so the lengths match and the comparison takes the same time either way. */
function sameCode(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Whether `given` is the code. A generated code is read without regard to case (people
 * retype it); one the operator chose is compared exactly.
 */
export function setupCodeMatches(given: unknown): boolean {
  if (typeof given !== "string") return false;
  const { code, chosen } = currentSetupCode();
  const trimmed = given.trim();
  return sameCode(chosen ? trimmed : trimmed.toUpperCase(), code);
}

/**
 * What a session token amounts to once it has been checked against the account behind it.
 *
 * `inactive` is kept apart from `revoked` because the two are told to the caller
 * differently — a deactivated account is a 403 with a sentence, a dead session is a plain 401
 * — and because the first has always been that way.
 */
export type SessionCheck =
  | {
      status: "ok";
      user: { id: string; username: string; role: Role };
      /**
       * What the token was minted under and when it stops being good (epoch ms), for a caller
       * that keeps the session open — a socket — and has to end it by itself later.
       */
      tokenVersion: number;
      expiresAt: number | null;
    }
  | { status: "invalid" }
  | { status: "gone" }
  | { status: "inactive" }
  | { status: "revoked" };

export class AuthService {
  /** How many accounts exist — the one question that decides whether the door is open. */
  async userCount(db: Pick<PoolClient, "query"> = pool): Promise<number> {
    const { rows } = await db.query("SELECT COUNT(*) FROM users");
    return Number.parseInt(rows[0].count, 10);
  }

  /**
   * Prints the setup code if the installation has no accounts, once, at startup.
   * Returns whether it did. A code the operator chose is announced but never printed.
   */
  async announceSetupCode(log: (line: string) => void = console.log): Promise<boolean> {
    if ((await this.userCount()) > 0) return false;
    const { code, chosen } = currentSetupCode();
    log("");
    log("🔑 Setup code: there are no accounts yet, so the first one needs a code.");
    if (chosen) {
      log("   The code is the value of SETUP_CODE in this server's environment.");
    } else {
      log(`   Setup code: ${code}`);
      log("   It lives in memory only and changes on every restart.");
    }
    log("   Open the app, choose Register and enter it. (`pnpm create-user` needs no code.)");
    log("");
    return true;
  }

  /**
   * Sign-up from the login screen.
   *
   * Open in exactly one case that cannot be configured away: an installation with no
   * users at all. Somebody has to be able to get in the first time, and that person is
   * the creator. After that the door is shut unless it was deliberately propped open.
   */
  async register(username: string, passwordPlain: string, email?: string, setupCode?: unknown) {
    const user = await this.registerAccount(username, passwordPlain, email, setupCode).catch(async (err: unknown) => {
      // Who was refused, and which door: a wrong setup code is somebody guessing at the first
      // account, a closed registration is somebody knocking.
      if (err instanceof SetupCodeError) {
        await audit.record({
          action: "auth.setup_code_used",
          outcome: "failure",
          meta: { attempted: attemptedName(username) },
        });
      } else if (err instanceof RegistrationClosedError) {
        await audit.record({
          action: "auth.register",
          outcome: "denied",
          meta: { attempted: attemptedName(username) },
        });
      }
      throw err;
    });
    // The new account is the actor of its own registration.
    const actor: Actor = { type: "user", userId: user.id, username: user.username };
    await audit.record({ action: "auth.register", actor, target: userTarget(user), meta: { role: user.role } });
    // Only the first account needs the code, and is the creator.
    if (user.role === "creator") {
      await audit.record({ action: "auth.setup_code_used", actor, target: userTarget(user) });
    }
    return user;
  }

  private async registerAccount(username: string, passwordPlain: string, email?: string, setupCode?: unknown) {
    const existingUsers = await this.userCount();
    if (existingUsers > 0 && !registrationOpen()) {
      throw new RegistrationClosedError();
    }
    // The first account is the creator, so it is not handed to whoever arrives first: it
    // needs the code the server printed. Checked before the username and password, so a
    // wrong code learns nothing about them. Once an account exists the code means nothing.
    if (existingUsers === 0 && !setupCodeMatches(setupCode)) {
      throw new SetupCodeError();
    }
    if (existingUsers > 0) return this.createAccount(username, passwordPlain, "viewer", email);

    // Nobody has an account *as far as the count above knew*. Six requests carrying the right
    // code all read zero, and each one would have made a creator. The decision is made again
    // under a lock, where only one of them sees an empty table.
    const account = await this.prepareAccount(username, passwordPlain);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockUntilTransactionEnds(client, LOCK_KEYS.firstAccount);
      const first = (await this.userCount(client)) === 0;
      // Somebody else was first. This request now stands where a later one would have: the
      // door is shut unless it was propped open, and what comes through it is a viewer.
      if (!first && !registrationOpen()) throw new RegistrationClosedError();

      const user = await this.insertUser(client, account, first ? "creator" : "viewer", email);
      await client.query("COMMIT");
      // The code did its one job. If every account were ever deleted a new one is made.
      if (first) generatedSetupCode = null;
      return user;
    } catch (err: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw translateDuplicateUsername(err) ?? err;
    } finally {
      client.release();
    }
  }

  /**
   * An account made by someone who already has one.
   *
   * Separate from {@link register} because the caller, not the count, decides the role —
   * and because the route above it is the thing that checks the caller is a creator.
   */
  async createUser(username: string, passwordPlain: string, role: Role, email?: string) {
    const user = await this.createAccount(username, passwordPlain, role, email);
    // The actor is whoever is in the context: the creator who invited them, or the operator
    // running `create-user`. Nothing about the password goes in.
    await audit.record({ action: "user.create", target: userTarget(user), meta: { role: user.role } });
    return user;
  }

  private async createAccount(username: string, passwordPlain: string, role: Role, email?: string) {
    const account = await this.prepareAccount(username, passwordPlain);

    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [account.name]);
    if (existing.rows.length > 0) {
      throw new AuthInputError("Username already taken");
    }

    try {
      return await this.insertUser(pool, account, role, email);
    } catch (err: unknown) {
      // The check above and this insert are two moments; the unique index is the one that
      // cannot be raced, and what it says is turned back into the sentence a person reads.
      throw translateDuplicateUsername(err) ?? err;
    }
  }

  /** The checks every new account passes, and the password hashed — slow, so done before any lock. */
  private async prepareAccount(
    username: string,
    passwordPlain: string
  ): Promise<{ name: string; passwordHash: string }> {
    const name = String(username ?? "").trim();
    if (name.length === 0) throw new AuthInputError("Username is required");
    if (String(passwordPlain ?? "").length < MIN_PASSWORD_LENGTH) {
      throw new AuthInputError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    return { name, passwordHash: await bcrypt.hash(passwordPlain, SALT_ROUNDS) };
  }

  private async insertUser(
    db: Pick<PoolClient, "query">,
    account: { name: string; passwordHash: string },
    role: Role,
    email?: string
  ) {
    const userId = uuidv4();
    await db.query(
      `INSERT INTO users (id, username, password_hash, email, role, active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [userId, account.name, account.passwordHash, email || null, role]
    );
    return { id: userId, username: account.name, email, role, active: true };
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
    // Open sockets are sessions too, and they are not asked again: they have to be told.
    if (!active && (rowCount ?? 0) > 0) notifySessionsEnded(id);
    if ((rowCount ?? 0) > 0) {
      await audit.record({
        action: active ? "user.activate" : "user.deactivate",
        target: await this.auditTargetOf(id),
      });
    }
    return (rowCount ?? 0) > 0;
  }

  /** The account as an audit target; just the id when it is already gone. */
  private async auditTargetOf(id: string): Promise<AuditTarget> {
    const { rows } = await pool.query<{ username: string }>("SELECT username FROM users WHERE id = $1", [id]);
    return rows[0] ? userTarget({ id, username: rows[0].username }) : { type: "user", id, ownerId: id };
  }

  /** Ends every session this account has, on every device, by outdating their tokens. */
  async revokeSessions(id: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
      [id]
    );
    if ((rowCount ?? 0) > 0) {
      notifySessionsEnded(id);
      await audit.record({ action: "auth.logout_all", target: await this.auditTargetOf(id) });
    }
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

    return {
      status: "ok",
      user: { id: current.id, username: current.username, role: current.role },
      tokenVersion: current.tokenVersion,
      expiresAt: typeof decoded.exp === "number" ? decoded.exp * 1000 : null,
    };
  }

  async login(username: string, passwordPlain: string) {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

    // The reason is for the audit trail only; the person is told the same thing for an
    // unknown name and a wrong password, as before.
    const failed = async (reason: string, known?: { id: string; username: string }): Promise<void> => {
      await audit.record({
        action: "auth.login",
        outcome: "failure",
        target: known ? userTarget(known) : { type: "user" },
        meta: { reason, attempted: attemptedName(username), knownAccount: known !== undefined },
      });
    };

    if (rows.length === 0) {
      await failed("unknown_user");
      throw new AuthInputError("Invalid username or password");
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(passwordPlain, user.password_hash);
    if (!isPasswordValid) {
      await failed("bad_password", user);
      throw new AuthInputError("Invalid username or password");
    }

    if (user.active === false) {
      await failed("account_deactivated", user);
      throw new AuthInputError("This account has been deactivated.");
    }

    const role: Role = isRole(user.role) ? user.role : "viewer";
    // The session does not exist yet, so the context still says "anonymous": the person who
    // just proved who they are is named here, and the controller names them for the rest of
    // the request.
    await audit.record({
      action: "auth.login",
      actor: { type: "user", userId: user.id, username: user.username },
      target: userTarget(user),
    });

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
    const { rows } = await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE username = $2 RETURNING id",
      [passwordHash, username]
    );
    for (const row of rows) {
      notifySessionsEnded(row.id);
      // By the terminal reset, so the actor is the operator (`cli`) and the target the account.
      await audit.record({
        action: "auth.password_change",
        target: userTarget({ id: row.id, username }),
        meta: { via: "reset" },
      });
    }
    return rows.length > 0;
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
      await audit.record({
        action: "auth.password_change",
        outcome: "failure",
        target: userTarget(user),
        meta: { reason: "current_password_incorrect" },
      });
      throw new AuthInputError("Current password is incorrect");
    }
    const passwordHash = await bcrypt.hash(newPasswordPlain, SALT_ROUNDS);
    // The version moves with the password: a stolen session should not survive the very
    // action a person takes to get rid of it.
    await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
      [passwordHash, userId]
    );
    notifySessionsEnded(userId);
    await audit.record({
      action: "auth.password_change",
      target: userTarget(user),
      meta: { via: "self" },
    });
    return true;
  }


  async setRole(username: string, role: Role): Promise<boolean> {
    const { rows: before } = await pool.query<{ id: string; role: string | null }>(
      "SELECT id, role FROM users WHERE username = $1",
      [username]
    );
    const { rowCount } = await pool.query("UPDATE users SET role = $1 WHERE username = $2", [
      role,
      username,
    ]);
    if ((rowCount ?? 0) > 0 && before[0]) {
      await audit.record({
        action: "user.role_change",
        target: userTarget({ id: before[0].id, username }),
        meta: { before: before[0].role ?? "viewer", after: role },
      });
    }
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
        exp?: number;
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

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db/connection.js";

const JWT_SECRET = process.env.JWT_SECRET || "zaatool-super-secret-key-12345";
const SALT_ROUNDS = 10;

export class AuthService {
  async register(username: string, passwordPlain: string, email?: string) {
    // Check if user exists
    const existing = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );
    if (existing.rows.length > 0) {
      throw new Error("Username already taken");
    }

    const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
    const userId = uuidv4();

    await pool.query(
      `INSERT INTO users (id, username, password_hash, email) 
       VALUES ($1, $2, $3, $4)`,
      [userId, username, passwordHash, email || null]
    );

    return { id: userId, username, email };
  }

  async login(username: string, passwordPlain: string) {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (rows.length === 0) {
      throw new Error("Invalid username or password");
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(passwordPlain, user.password_hash);
    if (!isPasswordValid) {
      throw new Error("Invalid username or password");
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    };
  }

  verifyToken(token: string) {
    try {
      return jwt.verify(token, JWT_SECRET) as { id: string; username: string };
    } catch (err) {
      return null;
    }
  }
}

export const authService = new AuthService();

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../db/connection.js";
import type { NotebookShare } from "@zaa-tool/shared";
import { actingUserId } from "../core/actor.js";
import { currentContext } from "../core/request-context.js";
import { audit } from "./audit.service.js";

/**
 * Links that let someone use a page without an account.
 *
 * The token is the credential, exactly as a webhook's slug is, so it follows the same
 * rules: long enough not to be guessed, hashed at rest, and revocable without deleting
 * the record of it having existed. A revoked link stays in the table with a timestamp
 * because "who could reach this, and when did that stop" is a question worth being able
 * to answer.
 *
 * A password is optional and separate. The link alone is a secret you can accidentally
 * forward; the password is the part you tell someone by other means.
 */

/** 32 bytes of randomness, url-safe. Long enough that guessing is not a strategy. */
function mintToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

interface ShareRow {
  id: string;
  notebook_id: string;
  password_hash: string | null;
  created_by: string | null;
  created_at: Date;
  last_used_at: Date | null;
  run_count: number;
  revoked_at: Date | null;
}

function toShare(row: ShareRow): NotebookShare {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    hasPassword: Boolean(row.password_hash),
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    runCount: row.run_count,
  };
}

export class NotebookSharesService {
  /** The notebook a share belongs to, as the audit trail names it: events about its links are events about it. */
  private async notebookTarget(notebookId: string) {
    const { rows } = await pool.query<{ name: string; owner_id: string | null }>(
      "SELECT name, owner_id FROM notebooks WHERE id = $1",
      [notebookId]
    );
    return { type: "notebook", id: notebookId, ownerId: rows[0]?.owner_id ?? null, name: rows[0]?.name ?? null };
  }

  async create(
    notebookId: string,
    createdBy: string,
    password?: string,
    createdByUserId: string | null = actingUserId(currentContext()?.actor)
  ): Promise<NotebookShare> {
    const id = crypto.randomUUID();
    const token = mintToken();
    const passwordHash = password?.trim() ? await bcrypt.hash(password.trim(), 10) : null;

    const { rows } = await pool.query<ShareRow>(
      `INSERT INTO notebook_shares (id, notebook_id, token_hash, password_hash, created_by, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, notebookId, hashToken(token), passwordHash, createdBy, createdByUserId]
    );

    // The link's token is never recorded, only the row's id.
    await audit.record({
      action: "share.create",
      target: await this.notebookTarget(notebookId),
      meta: { shareId: id, protected: passwordHash !== null },
    });

    // The only time the token is ever readable. After this it exists in the link and
    // nowhere else.
    return { ...toShare(rows[0]), token };
  }

  async listByNotebook(notebookId: string): Promise<NotebookShare[]> {
    const { rows } = await pool.query<ShareRow>(
      `SELECT * FROM notebook_shares
       WHERE notebook_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [notebookId]
    );
    return rows.map(toShare);
  }

  /**
   * Revoking is a timestamp: the link stops working, the record of it does not vanish.
   *
   * Under the notebook it belongs to: the id alone named a link on *any* notebook, so
   * somebody who could edit one could have ended another's.
   */
  async revoke(id: string, notebookId: string): Promise<{ revoked: boolean }> {
    const { rowCount } = await pool.query(
      "UPDATE notebook_shares SET revoked_at = NOW() WHERE id = $1 AND notebook_id = $2 AND revoked_at IS NULL",
      [id, notebookId]
    );
    if ((rowCount ?? 0) > 0) {
      await audit.record({
        action: "share.revoke",
        target: await this.notebookTarget(notebookId),
        meta: { shareId: id },
      });
    }
    return { revoked: (rowCount ?? 0) > 0 };
  }

  /** Resolves a link. Returns null for unknown *and* revoked, so probing tells nothing. */
  async resolve(token: string): Promise<ShareRow | null> {
    const { rows } = await pool.query<ShareRow>(
      "SELECT * FROM notebook_shares WHERE token_hash = $1 AND revoked_at IS NULL",
      [hashToken(token)]
    );
    return rows[0] ?? null;
  }

  async checkPassword(share: ShareRow, supplied: string | undefined): Promise<boolean> {
    if (!share.password_hash) return true;
    if (!supplied) return false;
    return bcrypt.compare(supplied, share.password_hash);
  }

  /** A wrong password at a shared page. The guess itself is never written down. */
  async recordPasswordFailure(share: ShareRow, outcome: "failure" | "denied", reason: string): Promise<void> {
    await audit.record({
      action: "share.password_failed",
      outcome,
      target: await this.notebookTarget(share.notebook_id),
      meta: { shareId: share.id, reason },
    });
  }

  async recordRun(id: string): Promise<void> {
    await pool.query(
      "UPDATE notebook_shares SET last_used_at = NOW(), run_count = run_count + 1 WHERE id = $1",
      [id]
    );
  }
}

export const notebookSharesService = new NotebookSharesService();
export type { ShareRow };

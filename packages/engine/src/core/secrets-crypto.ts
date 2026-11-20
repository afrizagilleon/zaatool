/**
 * Secrets at rest: AES-256-GCM, so a database dump or a leaked backup does not open them.
 *
 * Stored as `enc:v1:<iv>:<tag>:<ciphertext>` (each base64). The IV is 12 random bytes per
 * write. The authenticated data is `ownerId:key`, so a ciphertext copied onto another row
 * or another account fails to decrypt instead of quietly working there. A value without the
 * `enc:v1:` prefix is a plaintext written before encryption existed.
 *
 * Pure: the key is always passed in. Where it comes from is `config.ts`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
/**
 * The full 16-byte GCM tag, required on the way in. Node accepts a shorter tag unless told
 * otherwise, and every byte dropped from the tag halves and halves again the work of forging a
 * ciphertext that decrypts.
 */
const TAG_BYTES = 16;

/** 32 bytes written as 64 hex characters. */
export function parseSecretsKey(raw: string | undefined): Buffer | null {
  const text = raw?.trim() ?? "";
  return /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, "hex") : null;
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

function aad(ownerId: string, key: string): Buffer {
  return Buffer.from(`${ownerId}:${key}`, "utf8");
}

export function encryptValue(secretsKey: Buffer, ownerId: string, key: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", secretsKey, iv);
  cipher.setAAD(aad(ownerId, key));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}

/** Throws when the key is wrong, the row is not the one it was written for, or it was altered. */
export function decryptValue(secretsKey: Buffer, ownerId: string, key: string, stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const [iv, tag, body] = stored.slice(PREFIX.length).split(":");
  if (iv === undefined || tag === undefined || body === undefined) {
    throw new Error("Malformed encrypted secret.");
  }
  const tagBytes = Buffer.from(tag, "base64");
  if (tagBytes.length !== TAG_BYTES) throw new Error("Malformed encrypted secret.");
  const decipher = createDecipheriv("aes-256-gcm", secretsKey, Buffer.from(iv, "base64"), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad(ownerId, key));
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

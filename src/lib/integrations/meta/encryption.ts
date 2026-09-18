// META LEAD ADS — token encryption at rest (v0.19).
//
// AES-256-GCM. The raw access token NEVER appears in any GET/UI/log/AuditLog
// payload — only this module encrypts/decrypts `MetaConnection.tokenEncrypted`.
//
// KEY SOURCE: INTEGRATION_ENCRYPTION_KEY.
//   • Production: REQUIRED — a missing key throws (no insecure default).
//   • Non-production: a deterministic dev fallback is derived (with a loud
//     warning) so local/demo flows work; it is NOT a production default.
//
// Ciphertext format: v1.<iv-b64url>.<tag-b64url>.<ct-b64url> — versioned so a
// future algorithm rotation can migrate rows. Tampering breaks the GCM tag.

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

function deriveKey(secret: string): Buffer {
  // Accept a 64-char hex key directly; otherwise stretch with scrypt.
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  return scryptSync(secret, "leados-integration-key-v1", KEY_LEN);
}

export function resolveEncryptionKey(explicit?: string | null): Buffer {
  const secret = explicit?.trim() || process.env.INTEGRATION_ENCRYPTION_KEY?.trim() || undefined;
  if (secret) return deriveKey(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is required in production (no insecure default)");
  }
  // Dev/demo-only deterministic fallback. Explicitly NOT production.
  if (!(globalThis as { __leadosMetaKeyWarned?: boolean }).__leadosMetaKeyWarned) {
    (globalThis as { __leadosMetaKeyWarned?: boolean }).__leadosMetaKeyWarned = true;
    console.warn("[META-ENCRYPTION] INTEGRATION_ENCRYPTION_KEY not set — using DEV-ONLY derived key (never for production)");
  }
  const dbUrl = process.env.DATABASE_URL ?? "leados-dev";
  return deriveKey(createHash("sha256").update(`dev:${dbUrl}`).digest("hex"));
}

/** Encrypt a secret (access token). Returns versioned ciphertext. */
export function encryptToken(plaintext: string, explicitKey?: string | null): string {
  const key = resolveEncryptionKey(explicitKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Decrypt a versioned ciphertext. Throws on wrong key / tampering / bad format. */
export function decryptToken(ciphertext: string, explicitKey?: string | null): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Invalid token ciphertext format");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = resolveEncryptionKey(explicitKey);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]);
  return pt.toString("utf8");
}

/** Constant-time string equality helper (used by webhook secret checks). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba); // equalize timing
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** Masked token preview for DIAGNOSTICS ONLY (e.g. "EAAG…9x2"). Never the token. */
export function maskToken(token: string): string {
  if (token.length <= 8) return "…";
  return `${token.slice(0, 4)}…${token.slice(-3)}`;
}

/**
 * Meta Lead Ads Integration — Encryption Utilities
 * 
 * Provides symmetric encryption for storing access tokens at rest.
 * Uses AES-256-GCM with a key derived from INTEGRATION_ENCRYPTION_KEY.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 16 bytes authentication tag

let cachedKey: Buffer | null = null;

/**
 * Derive an AES-256 key from the encryption key environment variable.
 * The key should be a base64-encoded 32-byte random value.
 */
function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const keyBase64 = process.env.INTEGRATION_ENCRYPTION_KEY;

  if (!keyBase64) {
    // Generate a warning but allow operation in demo mode
    if (process.env.LEADOS_DEMO !== "true") {
      console.warn(
        "[Meta Integration] INTEGRATION_ENCRYPTION_KEY not set. Tokens will NOT be encrypted."
      );
    }
    // Create a dummy key for demo purposes - NOT SECURE
    const dummyKey = crypto.randomBytes(KEY_LENGTH);
    cachedKey = dummyKey;
    return cachedKey;
  }

  // Decode base64 key
  const keyData = Buffer.from(keyBase64, "base64");

  if (keyData.length !== KEY_LENGTH) {
    throw new Error(
      `INTEGRATION_ENCRYPTION_KEY must be a base64-encoded ${KEY_LENGTH}-byte key, got ${keyData.length} bytes`
    );
  }

  cachedKey = keyData;

  return cachedKey;
}

/**
 * Encrypt a plaintext string (token) and return base64-encoded ciphertext.
 * Format: iv (12 bytes) + ciphertext + tag (16 bytes), all base64 encoded.
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  // Combine iv + authTag + ciphertext, all base64 encoded
  const combined = Buffer.concat([
    iv,
    Buffer.from(authTag, "base64"),
    Buffer.from(encrypted, "base64"),
  ]);

  return combined.toString("base64");
}

/**
 * Decrypt a base64-encoded ciphertext back to plaintext.
 */
export function decryptToken(ciphertextBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(ciphertextBase64, "base64");

  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid ciphertext: too short");
  }

  const iv = combined.slice(0, IV_LENGTH);
  const authTag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH + TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, undefined, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    throw new Error("Failed to decrypt token: invalid ciphertext or key");
  }
}

/**
 * Clear the cached encryption key (useful for testing/key rotation).
 */
export function clearEncryptionKeyCache(): void {
  cachedKey = null;
}

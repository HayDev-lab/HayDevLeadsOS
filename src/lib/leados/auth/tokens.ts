// OPAQUE TOKEN UTILITIES (v0.17 spec 31, 98).
//
// Session / invite / reset tokens are 32 bytes of CSPRNG entropy rendered in
// base64url. Only the SHA-256 hash is persisted; the raw token exists solely
// inside the URL / cookie it was issued in. Comparisons on hashed values use
// constant-time equality.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time hex comparison (no early exit on first differing byte). */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison for webhook verification tokens.
 * Prevents timing attacks when comparing secrets.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  
  // If lengths differ, still compare to avoid timing leak
  const maxLen = Math.max(aBuf.length, bBuf.length);
  const paddedA = Buffer.alloc(maxLen, 0);
  const paddedB = Buffer.alloc(maxLen, 0);
  
  aBuf.copy(paddedA);
  bBuf.copy(paddedB);
  
  try {
    return timingSafeEqual(paddedA, paddedB) && a.length === b.length;
  } catch {
    return false;
  }
}

// HAYDEV LEADOS — PUBLIC SOURCE TOKENS (v0.19.2 hardening §7).
//
// Credential model for the PUBLIC lead ingestion endpoint
// (POST /api/v1/leads/ingest): a per-lead-source bearer token replaces the
// old org-slug-only "authentication".
//
//   token format : lsrc_<8-char prefix>_<24-char secret>   (total 39 chars)
//   storage      : SHA-256(token) ONLY (+ prefix, last4, timestamps)
//   reveal       : EXACTLY ONCE at create/rotate — never retrievable after
//   rotation     : POST   /api/v1/sources/[id]/token   (session + canMutate)
//   disable      : DELETE /api/v1/sources/[id]/token
//   lookup       : by indexed tokenPrefix, then constant-time hash compare
//
// The organization is ALWAYS resolved server-side from the validated source —
// a client never supplies (and is never trusted for) an org id.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

export const SOURCE_TOKEN_PREFIX = "lsrc_";

export class SourceAuthError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  constructor(code: string, message: string, httpStatus = 401) {
    super(message);
    this.name = "SourceAuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface GeneratedSourceToken {
  /** Full plaintext token — shown to the caller EXACTLY ONCE. */
  token: string;
  prefix: string;
  last4: string;
  hash: string;
}

/** Generate a new source token (no persistence — the caller stores the hash). */
export function generateSourceToken(): GeneratedSourceToken {
  const prefix = randomBytes(6).toString("base64url").slice(0, 8).replace(/[-_]/g, "a");
  const secret = randomBytes(24).toString("base64url").replace(/[-_]/g, "a").slice(0, 24);
  const token = `${SOURCE_TOKEN_PREFIX}${prefix}_${secret}`;
  return {
    token,
    prefix,
    last4: token.slice(-4),
    hash: hashSourceToken(token),
  };
}

/** SHA-256 hex of the full token — the ONLY stored secret material. */
export function hashSourceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Extract the bearer/source token from a request (Authorization: Bearer or x-source-token). */
export function extractSourceToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t.startsWith(SOURCE_TOKEN_PREFIX)) return t;
  }
  const alt = req.headers.get("x-source-token");
  if (alt?.trim()) return alt.trim();
  return null;
}

function safeHashEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface AuthenticatedSource {
  sourceId: string;
  organizationId: string;
  sourceType: string;
  sourceName: string;
}

/**
 * Authenticate a public-ingest request by source token.
 *
 * Resolution: token → prefix → LeadSource rows with that tokenPrefix
 * (prefix collisions across orgs are handled by verifying the hash against
 * every candidate) → constant-time hash comparison → active checks.
 * The organization comes from the SOURCE ROW — never from the payload.
 *
 * Throws SourceAuthError (401) on missing/invalid/disabled credentials and
 * 404-equivalent semantics for unknown prefixes (indistinguishable outcome).
 */
export async function authenticateSourceToken(token: string | null): Promise<AuthenticatedSource> {
  if (!token) {
    throw new SourceAuthError("source-token-missing", "Missing source credential (Authorization: Bearer lsrc_…)");
  }
  if (!token.startsWith(SOURCE_TOKEN_PREFIX) || token.length < SOURCE_TOKEN_PREFIX.length + 10) {
    throw new SourceAuthError("source-token-invalid", "Malformed source credential");
  }
  const body = token.slice(SOURCE_TOKEN_PREFIX.length);
  const prefix = body.split("_")[0] ?? "";
  if (!prefix) {
    throw new SourceAuthError("source-token-invalid", "Malformed source credential");
  }

  const candidates = await db.leadSource.findMany({
    where: { tokenPrefix: prefix },
    select: {
      id: true,
      organizationId: true,
      type: true,
      name: true,
      active: true,
      tokenHash: true,
      tokenDisabledAt: true,
    },
  });

  const receivedHash = hashSourceToken(token);
  const match = candidates.find((c) => c.tokenHash && safeHashEqual(c.tokenHash, receivedHash));

  if (!match) {
    // Unknown prefix OR wrong secret — identical observable outcome.
    throw new SourceAuthError("source-token-invalid", "Invalid source credential");
  }
  if (match.tokenDisabledAt) {
    throw new SourceAuthError("source-token-disabled", "Source credential is disabled — rotate it to resume ingestion");
  }
  if (!match.active) {
    throw new SourceAuthError("source-inactive", "Source is deactivated");
  }

  return {
    sourceId: match.id,
    organizationId: match.organizationId,
    sourceType: match.type,
    sourceName: match.name,
  };
}

/** Safe projection for API responses — NEVER includes the hash. */
export function sourceTokenMeta(source: {
  tokenPrefix: string | null;
  tokenLast4: string | null;
  tokenCreatedAt: Date | null;
  tokenRevealedAt: Date | null;
  tokenDisabledAt: Date | null;
}) {
  return {
    hasCredential: !!source.tokenPrefix,
    prefix: source.tokenPrefix,
    last4: source.tokenLast4,
    createdAt: source.tokenCreatedAt,
    revealedAt: source.tokenRevealedAt,
    disabledAt: source.tokenDisabledAt,
  };
}

/** Persist a newly generated credential (create or ROTATION — overwrites). */
export async function storeSourceToken(sourceId: string, generated: GeneratedSourceToken) {
  await db.leadSource.update({
    where: { id: sourceId },
    data: {
      tokenPrefix: generated.prefix,
      tokenHash: generated.hash,
      tokenLast4: generated.last4,
      tokenCreatedAt: new Date(),
      tokenRevealedAt: new Date(), // revealed NOW — the only time it is ever visible
      tokenDisabledAt: null,
    },
  });
}

/** Disable the credential (ingestion with it fails closed until rotated). */
export async function disableSourceToken(sourceId: string) {
  await db.leadSource.update({
    where: { id: sourceId },
    data: { tokenDisabledAt: new Date() },
  });
}

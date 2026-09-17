// SERVER-SIDE SESSION STORE (v0.17 spec 16–18, 24, 100).
//
// Opaque cookie token (leados_session) → SHA-256 hash in the Session table.
//   Absolute expiry: 30 days from creation (no eternal sessions).
//   Idle expiry: 7 days rolling, extended on activity (throttled — the
//     lastSeenAt/idle extension writes at most once per 5 minutes per
//     session to keep request overhead flat).
//   Rotation: every login issues a brand-new token (session fixation, spec
//     100). Revocation: single session or all of a user's sessions.

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { generateToken, hashToken } from "./tokens";

export const SESSION_COOKIE = "leados_session";

export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IDLE_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // throttle idle-extension writes

export interface SessionUserInfo {
  id: string;
  email: string;
  name: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  idleExpiresAt: Date;
}

export interface ValidatedSession {
  userId: string;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
}

export type SessionInvalidReason =
  | "NOT_FOUND"
  | "EXPIRED"
  | "IDLE_EXPIRED"
  | "REVOKED"
  | "USER_DISABLED";

export interface SessionValidation {
  valid: boolean;
  reason?: SessionInvalidReason;
  session?: ValidatedSession;
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<IssuedSession> {
  const token = generateToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_TTL_MS);
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
      expiresAt,
      idleExpiresAt,
    },
  });
  return { token, expiresAt, idleExpiresAt };
}

export async function validateSessionToken(token: string): Promise<SessionValidation> {
  const row = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, status: true } } },
  });
  if (!row) return { valid: false, reason: "NOT_FOUND" };
  if (row.revokedAt) return { valid: false, reason: "REVOKED" };
  const now = new Date();
  if (row.expiresAt <= now) return { valid: false, reason: "EXPIRED" };
  if (row.idleExpiresAt <= now) return { valid: false, reason: "IDLE_EXPIRED" };
  if (row.user.status !== "ACTIVE") return { valid: false, reason: "USER_DISABLED" };

  // Throttled idle extension (request overhead stays flat, spec 92).
  if (now.getTime() - row.lastSeenAt.getTime() > IDLE_TOUCH_INTERVAL_MS) {
    const cappedIdle = new Date(Math.min(
      now.getTime() + SESSION_IDLE_TTL_MS,
      row.expiresAt.getTime()
    ));
    await db.session.update({
      where: { id: row.id },
      data: { lastSeenAt: now, idleExpiresAt: cappedIdle },
    });
  }

  return {
    valid: true,
    session: { userId: row.userId, sessionId: row.id, issuedAt: row.createdAt, expiresAt: row.expiresAt },
  };
}

export async function revokeSessionToken(token: string): Promise<boolean> {
  const res = await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

/** Logout everywhere (spec 24) — also used after a password reset. */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

export async function listUserSessions(userId: string) {
  return db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });
}

// --- cookie plumbing ---------------------------------------------------------

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

/** Set the session cookie (server action / route handler context). */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

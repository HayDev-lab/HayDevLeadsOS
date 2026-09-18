// AUTH SERVICE (v0.17) — the business core of login and invite acceptance,
// extracted from the route handlers so it is unit-testable without Next
// request context. Routes only do cookie plumbing + HTTP mapping on top.

import { db } from "@/lib/db";
import { verifyPassword, hashPassword, validatePasswordPolicy } from "./password";
import { createSession, type IssuedSession } from "./session-store";
import { generateToken, hashToken } from "./tokens";
import { authLimiter } from "./rate-limit";
import { normalizeRole } from "./permissions";
import { recordAudit, AUDIT_ACTIONS, AUDIT_ACTOR } from "./audit";
import { INVITE_TTL_MS } from "../member-service";

// ---------------------------------------------------------------------------
// LOGIN (spec 19–22, 100)
// ---------------------------------------------------------------------------

export type LoginFailure = "RATE_LIMITED" | "LOCKED" | "INVALID" | "NO_ORGANIZATION";

export interface LoginResult {
  ok: boolean;
  failure?: LoginFailure;
  retryAfterSec?: number;
  user?: { id: string; name: string; email: string; role: string; organizationId: string };
  issued?: IssuedSession;
}

export async function performLogin(
  email: string,
  password: string,
  meta: { ip: string; userAgent: string | null }
): Promise<LoginResult> {
  const emailNorm = email.trim().toLowerCase();
  if (!authLimiter.checkRateLimit(`login:ip:${meta.ip}`)) {
    return { ok: false, failure: "RATE_LIMITED" };
  }
  const lock = authLimiter.lockStatus(`login:email:${emailNorm}`);
  if (lock.locked) {
    await recordAudit({
      actorType: AUDIT_ACTOR.ANONYMOUS,
      action: AUDIT_ACTIONS.LOGIN_LOCKED,
      resourceType: "session",
      metadata: { email: emailNorm },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ok: false, failure: "LOCKED", retryAfterSec: Math.ceil(lock.retryAfterMs / 1000) };
  }

  const user = await db.user.findUnique({ where: { email: emailNorm }, include: { organization: true } });
  const hash = user?.passwordHash ?? null;
  // Constant-ish work when the account does not exist (enumeration blunting).
  const passwordOk = await verifyPassword(password, hash ?? "$2b$12$0000000000000000000000000000000000000000000000000000");

  if (!user || !hash || !passwordOk || user.status !== "ACTIVE") {
    authLimiter.registerFailure(`login:email:${emailNorm}`);
    await recordAudit({
      organizationId: user?.organizationId ?? null,
      actorType: AUDIT_ACTOR.ANONYMOUS,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      resourceType: "session",
      metadata: { email: emailNorm },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ok: false, failure: "INVALID" };
  }

  authLimiter.clearFailures(`login:email:${emailNorm}`);
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  // A user with no ACTIVE membership has no workspace — issue no session
  // (spec 61 "organization missing" state): they need a fresh invite.
  if (!membership) {
    return { ok: false, failure: "NO_ORGANIZATION" };
  }
  const activeOrgId = membership.organizationId;
  const role = normalizeRole(membership.role);
  if (user.organizationId !== activeOrgId || user.role !== role) {
    await db.user.update({ where: { id: user.id }, data: { organizationId: activeOrgId, role } });
  }

  const issued = await createSession(user.id, { ip: meta.ip, userAgent: meta.userAgent });
  await recordAudit({
    organizationId: activeOrgId,
    actorUserId: user.id,
    actorType: AUDIT_ACTOR.USER,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resourceType: "session",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role, organizationId: activeOrgId },
    issued,
  };
}

// ---------------------------------------------------------------------------
// INVITE ACCEPTANCE (spec 30–32, 78–79)
// ---------------------------------------------------------------------------

export type InviteAcceptFailure =
  | "INVALID"
  | "ALREADY_USED"
  | "REVOKED"
  | "EXPIRED"
  | "SIGN_IN_REQUIRED"
  | "NAME_PASSWORD_REQUIRED"
  | "WEAK_PASSWORD"
  | "ALREADY_MEMBER";

export interface InviteAcceptResult {
  ok: boolean;
  failure?: InviteAcceptFailure;
  /** Set for the existing-user path: nothing further needed. */
  alreadyMember?: boolean;
  /** Set for the new-user path: a session was issued for the new account. */
  issued?: IssuedSession;
  organization?: { id: string; name: string };
  userId?: string;
}

export async function acceptInvite(input: {
  token: string;
  name?: string;
  password?: string;
  /** userId of the CURRENT authenticated user (existing-user path). */
  sessionUserId?: string | null;
  meta: { ip: string; userAgent: string | null };
}): Promise<InviteAcceptResult> {
  const invite = await db.organizationInvite.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { organization: true },
  });
  if (!invite) return { ok: false, failure: "INVALID" };
  if (invite.status === "ACCEPTED") return { ok: false, failure: "ALREADY_USED" };
  if (invite.status === "REVOKED") return { ok: false, failure: "REVOKED" };
  if (invite.expiresAt <= new Date()) {
    await db.organizationInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    return { ok: false, failure: "EXPIRED" };
  }

  const existingUser = await db.user.findUnique({ where: { email: invite.email } });

  if (existingUser) {
    // Path (b): the authenticated owner of this email accepts.
    if (!input.sessionUserId || input.sessionUserId !== existingUser.id) {
      return { ok: false, failure: "SIGN_IN_REQUIRED" };
    }
    const alreadyMember = await db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId: existingUser.id } },
    });
    if (alreadyMember) {
      await db.organizationInvite.updateMany({
        where: { id: invite.id, status: "PENDING" },
        data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByUserId: existingUser.id },
      });
      return { ok: true, alreadyMember: true, organization: invite.organization };
    }
    const claimed = await db.organizationInvite.updateMany({
      where: { id: invite.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByUserId: existingUser.id },
    });
    if (claimed.count === 0) return { ok: false, failure: "ALREADY_USED" };
    await db.organizationMember.create({
      data: { organizationId: invite.organizationId, userId: existingUser.id, role: invite.role },
    });
    await recordAudit({
      organizationId: invite.organizationId,
      actorUserId: existingUser.id,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.INVITE_ACCEPTED,
      resourceType: "member",
      resourceId: existingUser.id,
      metadata: { email: invite.email, role: invite.role, existingUser: true },
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    });
    return { ok: true, organization: invite.organization };
  }

  // Path (a): brand-new user — name + password required.
  if (!input.name || !input.password) return { ok: false, failure: "NAME_PASSWORD_REQUIRED" };
  const policy = validatePasswordPolicy(input.password);
  if (policy) return { ok: false, failure: "WEAK_PASSWORD" };
  const passwordHash = await hashPassword(input.password);

  const result = await db
    .$transaction(async (tx) => {
      // Atomic single-use claim INSIDE the transaction (spec 78).
      const claimed = await tx.organizationInvite.updateMany({
        where: { id: invite.id, status: "PENDING" },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw new Error("INVITE_ALREADY_USED");

      const user = await tx.user.create({
        data: {
          organizationId: invite.organizationId,
          name: input.name!,
          email: invite.email,
          passwordHash,
          role: invite.role,
          status: "ACTIVE",
          locale: invite.organization.locale,
          timezone: invite.organization.timezone,
        },
      });
      await tx.organizationMember.create({
        data: { organizationId: invite.organizationId, userId: user.id, role: invite.role },
      });
      await tx.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedByUserId: user.id },
      });
      return user;
    })
    .catch((e) => {
      if ((e as Error).message === "INVITE_ALREADY_USED") return "USED" as const;
      throw e;
    });
  if (result === "USED") return { ok: false, failure: "ALREADY_USED" };

  const issued = await createSession(result.id, { ip: input.meta.ip, userAgent: input.meta.userAgent });
  await recordAudit({
    organizationId: invite.organizationId,
    actorUserId: result.id,
    actorType: AUDIT_ACTOR.USER,
    action: AUDIT_ACTIONS.INVITE_ACCEPTED,
    resourceType: "member",
    resourceId: result.id,
    metadata: { email: invite.email, role: invite.role, newUser: true },
    ip: input.meta.ip,
    userAgent: input.meta.userAgent,
  });

  return { ok: true, issued, organization: invite.organization, userId: result.id };
}

/** Create a raw invite token WITHOUT rate limits or permission checks —
 * used by tests and the service layer. */
export async function mintInviteToken(inviteId: string): Promise<string> {
  const token = generateToken(32);
  await db.organizationInvite.update({
    where: { id: inviteId },
    data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  return token;
}

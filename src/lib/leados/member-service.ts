// TEAM / MEMBERSHIP SERVICE (v0.17 spec 30–36, 76, 110–117).
// Business rules for organization membership management. Every guard is
// SERVER-SIDE (the UI merely mirrors it); every mutation is audit-logged.

import { db } from "@/lib/db";
import { generateToken, hashToken } from "./auth/tokens";
import { normalizeRole, ROLES_V017, can, PERMISSIONS } from "./auth/permissions";
import type { Session } from "./context";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (spec 31)

export interface ServiceError {
  code: string;
  status: 400 | 403 | 404 | 409;
}

function err(status: ServiceError["status"], code: string): ServiceError {
  return { status, code };
}

const INVITABLE_ROLES = [ROLES_V017.ADMIN, ROLES_V017.MEMBER, ROLES_V017.VIEWER] as string[];

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listMembers(orgId: string) {
  const rows = await db.organizationMember.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, status: true, title: true,
          avatarColor: true, createdAt: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });
  return rows.map((m) => ({
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    userStatus: m.user.status,
    role: m.role,
    title: m.user.title,
    avatarColor: m.user.avatarColor,
    joinedAt: m.joinedAt,
    isSelf: false, // caller stamps this
  }));
}

export async function listInvites(orgId: string) {
  const rows = await db.organizationInvite.findMany({
    where: { organizationId: orgId, status: "PENDING" },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  return rows
    .filter((i) => i.expiresAt > now)
    .map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: i.invitedBy?.name ?? null,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    }));
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function createInvite(
  session: Session,
  input: { email: string; role: string }
): Promise<{ ok: true; inviteId: string; token: string; expiresAt: Date } | ServiceError> {
  if (!can(session.role, PERMISSIONS.MEMBER_MANAGE)) return err(403, "not-authorized");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, "invalid-email");
  if (!INVITABLE_ROLES.includes(input.role)) {
    // OWNER is never granted via invite (spec 32).
    return err(400, "invalid-invite-role");
  }
  // ADMINs may only invite MEMBER/VIEWER; OWNERs may also invite ADMINs.
  if (session.role !== ROLES_V017.OWNER && input.role === ROLES_V017.ADMIN) {
    return err(403, "only-owner-invites-admin");
  }

  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const member = await db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: session.orgId, userId: user.id } },
    });
    if (member) return err(400, "already-a-member");
  }

  // One PENDING invite per (org, email): replace any existing one.
  const existing = await db.organizationInvite.findFirst({
    where: { organizationId: session.orgId, email, status: "PENDING" },
  });
  if (existing) {
    await db.organizationInvite.delete({ where: { id: existing.id } });
  }

  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invite = await db.organizationInvite.create({
    data: {
      organizationId: session.orgId,
      email,
      role: input.role,
      status: "PENDING",
      tokenHash: hashToken(token),
      invitedById: session.userId,
      expiresAt,
    },
  });
  return { ok: true, inviteId: invite.id, token, expiresAt };
}

export async function resendInvite(
  session: Session,
  inviteId: string
): Promise<{ ok: true; token: string; expiresAt: Date } | ServiceError> {
  if (!can(session.role, PERMISSIONS.MEMBER_MANAGE)) return err(403, "not-authorized");
  const invite = await db.organizationInvite.findFirst({
    where: { id: inviteId, organizationId: session.orgId },
  });
  if (!invite) return err(404, "invite-not-found");
  if (invite.status !== "PENDING") return err(400, "invite-not-pending");

  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.organizationInvite.update({
    where: { id: invite.id },
    data: { tokenHash: hashToken(token), expiresAt, updatedAt: new Date() },
  });
  return { ok: true, token, expiresAt };
}

export async function revokeInvite(session: Session, inviteId: string): Promise<true | ServiceError> {
  if (!can(session.role, PERMISSIONS.MEMBER_MANAGE)) return err(403, "not-authorized");
  const invite = await db.organizationInvite.findFirst({
    where: { id: inviteId, organizationId: session.orgId },
  });
  if (!invite) return err(404, "invite-not-found");
  if (invite.status === "ACCEPTED") return err(400, "invite-already-accepted");
  if (invite.status === "REVOKED") return true;
  await db.organizationInvite.update({ where: { id: invite.id }, data: { status: "REVOKED" } });
  return true;
}

// ---------------------------------------------------------------------------
// Role change / removal — LAST OWNER protection lives here (spec 33, 35, 36, 76)
// ---------------------------------------------------------------------------

async function countActiveOwners(orgId: string): Promise<number> {
  return db.organizationMember.count({
    where: { organizationId: orgId, role: ROLES_V017.OWNER, status: "ACTIVE" },
  });
}

export async function changeMemberRole(
  session: Session,
  membershipId: string,
  newRole: string
): Promise<true | ServiceError> {
  if (!can(session.role, PERMISSIONS.MEMBER_MANAGE)) return err(403, "not-authorized");
  if (!INVITABLE_ROLES.includes(newRole)) return err(400, "invalid-role"); // no OWNER via PATCH (spec 33)

  const target = await db.organizationMember.findFirst({
    where: { id: membershipId, organizationId: session.orgId, status: "ACTIVE" },
  });
  if (!target) return err(404, "member-not-found");

  // LAST OWNER first (spec 33/36): the only OWNER cannot be demoted — by
  // anyone, including themselves (409 before the generic self-change 400).
  if (
    target.role === ROLES_V017.OWNER &&
    newRole !== ROLES_V017.OWNER &&
    (await countActiveOwners(session.orgId)) <= 1
  ) {
    return err(409, "last-owner-protected");
  }

  if (target.userId === session.userId) return err(400, "cannot-change-own-role");
  if (normalizeRole(target.role) === newRole) return err(400, "role-unchanged");

  // ADMINs may only manage MEMBER/VIEWER rows.
  if (session.role !== ROLES_V017.OWNER) {
    if (target.role === ROLES_V017.OWNER || target.role === ROLES_V017.ADMIN) {
      return err(403, "admin-cannot-manage-admins");
    }
    if (newRole === ROLES_V017.ADMIN) return err(403, "only-owner-grants-admin");
  }

  await db.organizationMember.update({
    where: { id: target.id },
    data: { role: newRole, updatedAt: new Date() },
  });
  // Keep the user's active-org role cache coherent.
  const user = await db.user.findUnique({ where: { id: target.userId } });
  if (user && user.organizationId === session.orgId) {
    await db.user.update({ where: { id: user.id }, data: { role: newRole } });
  }
  return true;
}

export async function removeMember(
  session: Session,
  membershipId: string
): Promise<true | ServiceError> {
  if (!can(session.role, PERMISSIONS.MEMBER_MANAGE)) return err(403, "not-authorized");
  const target = await db.organizationMember.findFirst({
    where: { id: membershipId, organizationId: session.orgId, status: "ACTIVE" },
  });
  if (!target) return err(404, "member-not-found");

  const self = target.userId === session.userId;

  // LAST OWNER cannot be removed — including self-removal (spec 35, 76, 112).
  if (target.role === ROLES_V017.OWNER && (await countActiveOwners(session.orgId)) <= 1) {
    return err(409, "last-owner-protected");
  }

  // ADMINs cannot remove OWNERs or other ADMINs (they may leave themselves).
  if (!self && session.role !== ROLES_V017.OWNER) {
    if (target.role === ROLES_V017.OWNER || target.role === ROLES_V017.ADMIN) {
      return err(403, "admin-cannot-remove-admins");
    }
  }

  // Removed membership = the row is GONE → their next request in this org
  // fails server-side (spec 80, 112). Sessions are NOT revoked: the user may
  // still legitimately work in another organization.
  await db.organizationMember.delete({ where: { id: target.id } });

  // Revoke any pending invites for the same email so they cannot re-join
  // through an old link.
  const removedUser = await db.user.findUnique({ where: { id: target.userId }, select: { email: true } });
  if (removedUser) {
    await db.organizationInvite.updateMany({
      where: { organizationId: session.orgId, email: removedUser.email, status: "PENDING" },
      data: { status: "REVOKED" },
    });
  }
  return true;
}

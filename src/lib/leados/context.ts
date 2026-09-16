// Server-side session context — enforces organization isolation on every query.
// MVP demo mode: a cookie selects the active user (default demo user if unset).
// Every API route MUST call getSession() and use session.orgId to scope DB queries.

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ROLES, type Role } from "./constants";

export interface Session {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    title?: string | null;
    avatarColor?: string | null;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    locale: string;
    timezone: string;
    currency: string;
  };
  orgId: string;
  userId: string;
  role: Role;
}

const SESSION_COOKIE = "leados_uid";
const ORG_COOKIE = "leados_oid";

/**
 * Resolve the current session. Falls back to the first organization + a default
 * demo user when no cookie is present (so the app boots with seed data).
 * NEVER returns a session for a different organization than the user belongs to.
 */
export async function getSession(): Promise<Session> {
  const cookieStore = await cookies();
  const userId = cookieStore.get(SESSION_COOKIE)?.value;
  const orgHint = cookieStore.get(ORG_COOKIE)?.value;

  // Try to load the user from the cookie
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });
    if (user && user.organization && user.status === "ACTIVE") {
      return toSession(user, user.organization);
    }
  }
  // Otherwise fall back to the org hint's first owner, or the very first org.
  const org = orgHint
    ? await db.organization.findUnique({ where: { id: orgHint } })
    : null;
  const finalOrg =
    org ??
    (await db.organization.findFirst({
      orderBy: { createdAt: "asc" },
    }));

  if (!finalOrg) {
    throw new Error("LEADOS_NO_ORG: seed the database first (run /api/v1/seed)");
  }
  // Pick an owner/admin/manager in that org, prefer OWNER
  const user =
    (await db.user.findFirst({
      where: { organizationId: finalOrg.id, role: ROLES.OWNER, status: "ACTIVE" },
    })) ??
    (await db.user.findFirst({
      where: { organizationId: finalOrg.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    }));
  if (!user) {
    throw new Error("LEADOS_NO_USER: seed the database first (run /api/v1/seed)");
  }
  const fullUser = await db.user.findUnique({
    where: { id: user.id },
    include: { organization: true },
  });
  return toSession(fullUser!, finalOrg);
}

function toSession(
  user: { id: string; name: string; email: string; role: string; title?: string | null; avatarColor?: string | null; organization: { id: string; name: string; slug: string; locale: string; timezone: string; currency: string } },
  org: { id: string; name: string; slug: string; locale: string; timezone: string; currency: string }
): Session {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      title: user.title,
      avatarColor: user.avatarColor,
    },
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      locale: org.locale,
      timezone: org.timezone,
      currency: org.currency,
    },
    orgId: org.id,
    userId: user.id,
    role: user.role as Role,
  };
}

export function canManage(role: Role): boolean {
  return role === ROLES.OWNER || role === ROLES.ADMIN;
}

export function canMutate(role: Role): boolean {
  return role !== ROLES.VIEWER;
}

// Server-side session context — enforces authentication + organization
// isolation on every query (v0.17 PRODUCTION AUTH).
//
// TWO MODES (spec 25):
//   LEADOS_DEMO=false (production) — a valid server-side session is REQUIRED:
//     cookie token → Session row → ACTIVE user → ACTIVE OrganizationMember
//     in the active org. Anything else throws AuthRequiredError → 401 via
//     apiError(). There is NO implicit login, NO fallback user, NO trust in
//     client-supplied ids.
//   LEADOS_DEMO=true (demo) — preserves the public-demo UX: a synthetic demo
//     session inside the isDemo organization. Demo sessions can NEVER see
//     real (non-demo) organizations (spec 26).
//
// Every API route MUST call getSession() and use session.orgId to scope DB
// queries. Removed membership blocks access IMMEDIATELY on the next request
// because membership is re-validated every time (spec 29, 80).

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ROLES } from "./constants";
import { readSessionCookie, validateSessionToken } from "./auth/session-store";
import { normalizeRole, permissionsForRole, canManageRole, canMutateRole, PERMISSIONS, type Permission } from "./auth/permissions";

export { canManageRole as canManage, canMutateRole as canMutate, PERMISSIONS };

// ---------------------------------------------------------------------------
// Errors — mapped to HTTP statuses by apiError() in lib/leados/api.ts.
// ---------------------------------------------------------------------------

export class AuthRequiredError extends Error {
  readonly authStatus = 401;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class ForbiddenError extends Error {
  readonly authStatus = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// ---------------------------------------------------------------------------
// Session shape (additive vs pre-v0.17: permissions, locale, timezone, demo)
// ---------------------------------------------------------------------------

export interface Session {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    title?: string | null;
    avatarColor?: string | null;
    locale: string;
    timezone: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    locale: string;
    timezone: string;
    currency: string;
    isDemo: boolean;
  };
  orgId: string;
  userId: string;
  role: string;
  /** Membership role in the active org — the authorization source of truth. */
  membership: { role: string; joinedAt: Date };
  permissions: Permission[];
  /** True when the session is the synthetic demo (demo org only). */
  demo: boolean;
  /** True when resolved from a real password-authenticated session row. */
  authenticated: boolean;
  /** Session row id (real sessions only). */
  sessionId?: string;
}

/** Demo mode flag (spec 25). Unset/false ⇒ production auth is mandatory. */
export function isDemoMode(): boolean {
  return process.env.LEADOS_DEMO === "true";
}

const DEMO_UID_COOKIE = "leados_uid";
const DEMO_ORG_COOKIE = "leados_oid";

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the current session (auth + org + membership + permissions).
 *
 * Production: throws AuthRequiredError when not authenticated.
 * Demo: falls back to the synthetic demo session (demo org only).
 */
export async function getSession(): Promise<Session> {
  const token = await readSessionCookie();
  const auth = await resolveAuthenticatedSessionFromToken(token);
  if (auth) return auth;

  if (!isDemoMode()) {
    throw new AuthRequiredError();
  }

  // DEMO MODE (spec 25–26): synthetic session, strictly inside a demo org.
  return resolveDemoSession();
}

/** Like getSession() but returns null instead of throwing when unauthenticated. */
export async function getSessionOrNull(): Promise<Session | null> {
  try {
    return await getSession();
  } catch {
    return null;
  }
}

/** Real session resolution — shared by both modes. Testable with an explicit
 * token (no cookie dependency). */
export async function resolveAuthenticatedSessionFromToken(token: string | null): Promise<Session | null> {
  if (!token) return null;
  const validation = await validateSessionToken(token);
  if (!validation.valid || !validation.session) return null;
  const userId = validation.session.userId;

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { organization: true },
  });
  if (!user || user.status !== "ACTIVE") return null;

  const membership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: user.organizationId, userId: user.id } },
  });

  let activeOrg = user.organization;
  let activeMembership = membership;

  // Membership lost for the active org (removed / org deleted) → SAFE FALLBACK
  // (spec 29): hop to the user's first remaining ACTIVE membership, if any.
  if (!activeMembership || activeMembership.status !== "ACTIVE" || !activeOrg) {
    const fallback = await db.organizationMember.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      include: { organization: true },
    });
    if (!fallback) return null; // no organization left → unauthenticated state
    activeOrg = fallback.organization;
    activeMembership = fallback;
    await db.user.update({
      where: { id: user.id },
      data: { organizationId: fallback.organizationId, role: fallback.role },
    });
  }

  return buildSession(user, activeOrg, activeMembership, {
    authenticated: true,
    demo: false,
    sessionId: validation.session.sessionId,
  });
}

/** Synthetic demo session — demo org + its owner, or the demo user switcher. */
async function resolveDemoSession(): Promise<Session> {
  // 1. Demo user switcher (dev/demo UX): pick a user inside a DEMO org only.
  const cookieStore = await cookies();
  const demoUid = cookieStore.get(DEMO_UID_COOKIE)?.value;
  if (demoUid) {
    const user = await db.user.findUnique({
      where: { id: demoUid },
      include: { organization: true },
    });
    if (user && user.organization?.isDemo && user.status === "ACTIVE") {
      const membership =
        (await db.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: user.organizationId, userId: user.id } },
        })) ??
        (await db.organizationMember.create({
          data: { organizationId: user.organizationId, userId: user.id, role: normalizeRole(user.role) },
        }));
      return buildSession(user, user.organization, membership, { authenticated: false, demo: true });
    }
  }

  // 2. Implicit demo login: the demo org's OWNER (or first active member).
  const demoOrg =
    (await db.organization.findFirst({ where: { isDemo: true }, orderBy: { createdAt: "asc" } })) ?? null;
  if (!demoOrg) {
    throw new AuthRequiredError("demo-not-seeded");
  }
  const owner =
    (await db.organizationMember.findFirst({
      where: { organizationId: demoOrg.id, role: ROLES.OWNER },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    })) ??
    (await db.organizationMember.findFirst({
      where: { organizationId: demoOrg.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }));
  if (!owner) {
    // Pre-backfill database: derive the membership from the legacy user row.
    const legacyUser = await db.user.findFirst({
      where: { organizationId: demoOrg.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    if (!legacyUser) throw new AuthRequiredError("demo-not-seeded");
    const membership = await db.organizationMember.create({
      data: { organizationId: demoOrg.id, userId: legacyUser.id, role: normalizeRole(legacyUser.role) },
    });
    return buildSession(legacyUser, demoOrg, membership, { authenticated: false, demo: true });
  }
  return buildSession(owner.user, demoOrg, owner, { authenticated: false, demo: true });
}

function buildSession(
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    title?: string | null;
    avatarColor?: string | null;
    locale: string;
    timezone: string;
    organizationId: string;
  },
  org: {
    id: string;
    name: string;
    slug: string;
    locale: string;
    timezone: string;
    currency: string;
    isDemo: boolean;
  },
  membership: { role: string; joinedAt: Date },
  flags: { authenticated: boolean; demo: boolean; sessionId?: string }
): Session {
  const role = normalizeRole(membership.role);
  // Keep the legacy User.role cache in sync (display column only).
  if (user.role !== role) {
    db.user
      .update({ where: { id: user.id }, data: { role } })
      .catch(() => undefined); // fire-and-forget cache sync
  }
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      title: user.title,
      avatarColor: user.avatarColor,
      locale: user.locale,
      timezone: user.timezone,
    },
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      locale: org.locale,
      timezone: org.timezone,
      currency: org.currency,
      isDemo: org.isDemo,
    },
    orgId: org.id,
    userId: user.id,
    role,
    membership: { role, joinedAt: membership.joinedAt },
    permissions: permissionsForRole(role),
    demo: flags.demo,
    authenticated: flags.authenticated,
    sessionId: flags.sessionId,
  };
}

// ---------------------------------------------------------------------------
// Permission helpers (spec 11)
// ---------------------------------------------------------------------------

export function sessionCan(session: Session, permission: Permission): boolean {
  return session.permissions.includes(permission);
}

/** Throws ForbiddenError when the session lacks the permission. */
export function requirePermission(session: Session, permission: Permission): void {
  if (!sessionCan(session, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

export type { Permission };

// CURRENT AUTH CONTEXT (v0.17 spec 63–64, 27): session + memberships +
// permissions — powers the organization switcher and the user menu.

import { db } from "@/lib/db";
import { ok, apiError } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";
import { listUserSessions } from "@/lib/leados/auth/session-store";

export async function GET() {
  try {
    const session = await getSession();
    const memberships = await db.organizationMember.findMany({
      where: { userId: session.userId, status: "ACTIVE" },
      include: { organization: { select: { id: true, name: true, slug: true, isDemo: true } } },
      orderBy: { createdAt: "asc" },
    });
    const sessions = session.authenticated ? await listUserSessions(session.userId) : [];
    return ok({
      session,
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        role: m.role,
        organization: m.organization,
        active: m.organizationId === session.orgId,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        current: s.id === session.sessionId,
      })),
    });
  } catch (e) {
    return apiError("me-failed", e);
  }
}

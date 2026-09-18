// SESSION BOOTSTRAP (v0.17): GET resolves the current session (demo mode
// falls back to the synthetic demo session; production 401s via apiError).
// POST = DEMO USER SWITCHER — only exists while LEADOS_DEMO=true; production
// returns 403 (real users authenticate via /api/v1/auth/login).

import { db } from "@/lib/db";
import { ok, forbidden, badRequest, apiError } from "@/lib/leados/api";
import { getSession, isDemoMode } from "@/lib/leados/context";

export async function GET() {
  try {
    const session = await getSession();
    const users = await db.organizationMember.findMany({
      where: { organizationId: session.orgId, status: "ACTIVE" },
      include: { user: { select: { id: true, name: true, email: true, role: true, title: true, avatarColor: true, status: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return ok({
      session,
      users: users
        .filter((m) => m.user.status === "ACTIVE")
        .map((m) => ({ ...m.user, role: m.role })),
    });
  } catch (e) {
    return apiError("session-failed", e);
  }
}

const Switch = { parse: (body: unknown): { userId?: string } => (body ?? {}) as { userId?: string } };

export async function POST(req: Request) {
  try {
    if (!isDemoMode()) {
      return forbidden("User switching is a demo feature. Sign in with your own account.");
    }
    const session = await getSession();
    const body = await req.json().catch(() => null);
    const v = Switch.parse(body);
    if (!v.userId || typeof v.userId !== "string") return badRequest("userId required");

    // DEMO SWITCHER: only between members of the SAME DEMO organization.
    const target = await db.organizationMember.findFirst({
      where: {
        organizationId: session.orgId,
        userId: v.userId,
        status: "ACTIVE",
      },
      include: { user: true, organization: true },
    });
    if (!target || !target.organization.isDemo || target.user.status !== "ACTIVE") {
      return badRequest("user-not-in-org");
    }
    const { cookies } = await import("next/headers");
    const c = await cookies();
    c.set("leados_uid", target.userId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return ok({ ok: true, user: { id: target.user.id, name: target.user.name, role: target.role } });
  } catch (e) {
    return apiError("switch-user-failed", e);
  }
}

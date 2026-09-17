// DEMO LOGIN (v0.17 spec 25–26): public-demo shortcut, STRICTLY gated by
// LEADOS_DEMO=true. Issues a REAL server-side session for the demo org
// owner, so the demo exercises the same production auth pipeline. The demo
// session is pinned to the isDemo organization and can never reach real orgs.

import { db } from "@/lib/db";
import { ok, forbidden, tooMany, apiError } from "@/lib/leados/api";
import { isDemoMode } from "@/lib/leados/context";
import { createSession, setSessionCookie } from "@/lib/leados/auth/session-store";
import { actionLimiter, clientIp } from "@/lib/leados/auth/rate-limit";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { normalizeRole } from "@/lib/leados/auth/permissions";

export async function POST(req: Request) {
  const meta = requestMeta(req);
  try {
    if (!isDemoMode()) {
      // Production build: the shortcut does not exist (spec 25).
      return forbidden("Demo login is disabled.");
    }
    if (!actionLimiter.checkRateLimit(`demo-login:${clientIp(req)}`)) {
      return tooMany("Too many demo logins. Please wait.");
    }

    const demoOrg = await db.organization.findFirst({
      where: { isDemo: true },
      orderBy: { createdAt: "asc" },
    });
    if (!demoOrg) {
      return forbidden("Demo is not available. Seed the demo data first.");
    }
    const membership =
      (await db.organizationMember.findFirst({
        where: { organizationId: demoOrg.id, role: "OWNER" },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await db.organizationMember.findFirst({
        where: { organizationId: demoOrg.id },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      }));
    if (!membership || membership.user.status !== "ACTIVE") {
      return forbidden("Demo is not available. Seed the demo data first.");
    }

    const user = membership.user;
    await db.user.update({
      where: { id: user.id },
      data: { organizationId: demoOrg.id, role: normalizeRole(membership.role) },
    });
    const issued = await createSession(user.id, { ip: meta.ip, userAgent: meta.userAgent });
    await setSessionCookie(issued.token, issued.expiresAt);

    await recordAudit({
      organizationId: demoOrg.id,
      actorUserId: user.id,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resourceType: "session",
      metadata: { demo: true },
      ...meta,
    });

    return ok({
      ok: true,
      demo: true,
      user: { id: user.id, name: user.name, email: user.email, role: membership.role },
      organizationId: demoOrg.id,
    });
  } catch (e) {
    return apiError("demo-login-failed", e);
  }
}

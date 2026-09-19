// FIRST-RUN BOOTSTRAP (v0.17): claim the first production account.
//
// Gate: allowed ONLY while NO user in the database has a password. This is
// the WordPress-style install gate — the moment one real account exists the
// endpoint closes forever (403) and normal login/invite flows take over.
// A user inside a DEMO org cannot be claimed (demo data stays passwordless);
// claiming creates a fresh organization + OWNER instead.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, forbidden, badRequest, tooMany, apiError, validate, parseJson } from "@/lib/leados/api";
import { isDemoMode } from "@/lib/leados/context";
import { hashPassword, validatePasswordPolicy } from "@/lib/leados/auth/password";
import { createSession, setSessionCookie } from "@/lib/leados/auth/session-store";
import { actionLimiter, clientIp } from "@/lib/leados/auth/rate-limit";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";

const BootstrapSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120).optional(),
  organizationName: z.string().min(2).max(120).optional(),
});

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `org-${Date.now().toString(36)}`
  );
}

export async function POST(req: Request) {
  const meta = requestMeta(req);
  try {
    // v0.19.3 DEMO ISOLATION: bootstrap mints a REAL (isDemo=false)
    // organization with an OWNER account. Under LEADOS_DEMO=true that would
    // create a real org beside anonymous demo-owner sessions — the exact
    // mixed deployment the boot invariant refuses. Fail closed here too.
    if (isDemoMode()) {
      return forbidden("Bootstrap is disabled while the app runs in demo mode (LEADOS_DEMO=true).");
    }
    if (!actionLimiter.checkRateLimit(`bootstrap:${clientIp(req)}`)) {
      return tooMany("Too many attempts. Try again later.");
    }
    const body = await parseJson(req);
    const v = validate(BootstrapSchema, body);
    if (!v.ok) return v.error;
    const policy = validatePasswordPolicy(v.value.password);
    if (policy) return badRequest(policy);

    // GATE: one-time only — any existing password closes bootstrap.
    const anyRealAccount = await db.user.findFirst({ where: { passwordHash: { not: null } }, select: { id: true } });
    if (anyRealAccount) {
      return forbidden("Bootstrap already completed. Please sign in.");
    }

    const email = v.value.email.trim().toLowerCase();
    const passwordHash = await hashPassword(v.value.password);

    const existing = await db.user.findUnique({ where: { email }, include: { organization: true } });
    if (existing) {
      if (existing.organization.isDemo) {
        return badRequest("This email belongs to demo data. Create a new organization instead.");
      }
      // Claim the existing (passwordless) account.
      await db.user.update({ where: { id: existing.id }, data: { passwordHash, status: "ACTIVE" } });
      await db.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: existing.organizationId, userId: existing.id } },
        create: { organizationId: existing.organizationId, userId: existing.id, role: "OWNER" },
        update: { role: "OWNER", status: "ACTIVE" },
      });
      const issued = await createSession(existing.id, { ip: meta.ip, userAgent: meta.userAgent });
      await setSessionCookie(issued.token, issued.expiresAt);
      await recordAudit({
        organizationId: existing.organizationId,
        actorUserId: existing.id,
        actorType: AUDIT_ACTOR.USER,
        action: AUDIT_ACTIONS.BOOTSTRAP_COMPLETED,
        resourceType: "user",
        resourceId: existing.id,
        metadata: { claimed: true },
        ...meta,
      });
      return ok({ ok: true, claimed: true, userId: existing.id, organizationId: existing.organizationId });
    }

    if (!v.value.organizationName) {
      return badRequest("organizationName is required for a new account");
    }

    const result = await db.$transaction(async (tx) => {
      let slug = slugify(v.value.organizationName!);
      const clash = await tx.organization.findUnique({ where: { slug } });
      if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
      const org = await tx.organization.create({
        data: { name: v.value.organizationName!, slug, isDemo: false },
      });
      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          name: v.value.name ?? email.split("@")[0],
          email,
          passwordHash,
          role: "OWNER",
          status: "ACTIVE",
          locale: org.locale,
          timezone: org.timezone,
        },
      });
      await tx.organizationMember.create({
        data: { organizationId: org.id, userId: user.id, role: "OWNER" },
      });
      return { org, user };
    });

    const issued = await createSession(result.user.id, { ip: meta.ip, userAgent: meta.userAgent });
    await setSessionCookie(issued.token, issued.expiresAt);
    await recordAudit({
      organizationId: result.org.id,
      actorUserId: result.user.id,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.BOOTSTRAP_COMPLETED,
      resourceType: "organization",
      resourceId: result.org.id,
      metadata: { created: true, organization: result.org.name },
      ...meta,
    });
    return ok({ ok: true, created: true, userId: result.user.id, organizationId: result.org.id });
  } catch (e) {
    return apiError("bootstrap-failed", e);
  }
}

export async function GET() {
  // Status probe for the login screen: is bootstrap still open + demo mode.
  try {
    const anyRealAccount = await db.user.findFirst({ where: { passwordHash: { not: null } }, select: { id: true } });
    const anyOrg = await db.organization.findFirst({ select: { id: true } });
    return ok({
      bootstrapOpen: !anyRealAccount,
      hasData: Boolean(anyOrg),
      demoMode: process.env.LEADOS_DEMO === "true",
    });
  } catch (e) {
    return apiError("bootstrap-status-failed", e);
  }
}

// ORGANIZATION SWITCH (v0.17 spec 27–29, 77, 111).
// The client may only name the target organization — the SERVER verifies an
// ACTIVE membership before anything changes. No cookie trust.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, notFound, forbidden, badRequest, apiError, validate, parseJson } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { normalizeRole } from "@/lib/leados/auth/permissions";

const SwitchSchema = z.object({ organizationId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    const body = await parseJson(req);
    const v = validate(SwitchSchema, body);
    if (!v.ok) return v.error;

    // Demo sessions are pinned to the demo org (spec 26).
    if (session.demo) return badRequest("Demo session cannot switch organization");

    // SERVER-SIDE MEMBERSHIP VALIDATION (spec 28): a random org id is simply
    // not found — no existence leak.
    const membership = await db.organizationMember.findFirst({
      where: {
        userId: session.userId,
        organizationId: v.value.organizationId,
        status: "ACTIVE",
      },
      include: { organization: true },
    });
    if (!membership) return notFound("organization");

    await db.user.update({
      where: { id: session.userId },
      data: { organizationId: membership.organizationId, role: normalizeRole(membership.role) },
    });

    await recordAudit({
      organizationId: membership.organizationId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.ORG_SWITCHED,
      resourceType: "organization",
      resourceId: membership.organizationId,
      metadata: { from: session.orgId },
      ...meta,
    });

    return ok({ ok: true, organization: membership.organization, role: membership.role });
  } catch (e) {
    return apiError("switch-org-failed", e);
  }
}

export async function GET() {
  // Convenience: list switchable organizations (same data as /auth/me).
  try {
    const session = await getSession();
    const memberships = await db.organizationMember.findMany({
      where: { userId: session.userId, status: "ACTIVE" },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      memberships: memberships.map((m) => ({ ...m.organization, role: m.role, active: m.organizationId === session.orgId })),
    });
  } catch (e) {
    return apiError("switch-org-list-failed", e);
  }
}

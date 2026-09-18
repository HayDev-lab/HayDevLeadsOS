// MEMBER MANAGEMENT (v0.17 spec 34–36, 110): change role / remove member.
// All guards (last-owner, self-demotion, admin scope) are enforced in
// member-service — this route only maps service results to HTTP.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, badRequest, forbidden, notFound, conflict, apiError, validate, parseJson } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";
import { changeMemberRole, removeMember } from "@/lib/leados/member-service";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { ROLES } from "@/lib/leados/constants";
import { invalidateOrgCache } from "@/lib/leados/api-cache";

const PatchSchema = z.object({
  role: z.enum([ROLES.ADMIN, ROLES.MEMBER, ROLES.VIEWER]),
});

function mapServiceError(status: number, code: string) {
  if (status === 404) return notFound(code);
  if (status === 403) return forbidden(code);
  if (status === 409) return conflict(code);
  return badRequest(code);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const body = await parseJson(req);
    const v = validate(PatchSchema, body);
    if (!v.ok) return v.error;

    const before = await db.organizationMember.findFirst({
      where: { id, organizationId: session.orgId },
      select: { userId: true, role: true },
    });

    const result = await changeMemberRole(session, id, v.value.role);
    if (result !== true) return mapServiceError(result.status, result.code);

    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
      resourceType: "member",
      resourceId: id,
      metadata: { from: before?.role ?? null, to: v.value.role, userId: before?.userId ?? null },
      ...meta,
    });
    // v0.21: membership feeds the cached /team read — invalidate eagerly.
    invalidateOrgCache(session.orgId);
    return ok({ ok: true });
  } catch (e) {
    return apiError("member-role-change-failed", e);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const before = await db.organizationMember.findFirst({
      where: { id, organizationId: session.orgId },
      include: { user: { select: { email: true } } },
    });

    const result = await removeMember(session, id);
    if (result !== true) return mapServiceError(result.status, result.code);

    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.MEMBER_REMOVED,
      resourceType: "member",
      resourceId: id,
      metadata: { email: before?.user.email ?? null, userId: before?.userId ?? null, self: before?.userId === session.userId },
      ...meta,
    });
    // v0.21: membership feeds the cached /team read — invalidate eagerly.
    invalidateOrgCache(session.orgId);
    return ok({ ok: true });
  } catch (e) {
    return apiError("member-remove-failed", e);
  }
}

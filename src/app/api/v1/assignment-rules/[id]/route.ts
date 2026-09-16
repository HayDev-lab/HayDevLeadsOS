import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, parseJson } from "@/lib/leados/api";
import { z } from "zod";

const Update = z.object({
  name: z.string().min(1).max(80).optional(),
  sourceId: z.string().nullable().optional(),
  sourceType: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  assigneeId: z.string().optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit assignment rules");
    const { id } = await ctx.params;
    const rule = await db.assignmentRule.findUnique({ where: { id } });
    if (!rule || rule.organizationId !== session.orgId) return notFound("rule");
    const body = await parseJson(req);
    const v = Update.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const data: Record<string, unknown> = {};
    if (v.data.name !== undefined) data.name = v.data.name;
    if (v.data.sourceId !== undefined) data.sourceId = v.data.sourceId;
    if (v.data.sourceType !== undefined) data.sourceType = v.data.sourceType;
    if (v.data.priority !== undefined) data.priority = v.data.priority;
    if (v.data.enabled !== undefined) data.enabled = v.data.enabled;
    if (v.data.position !== undefined) data.position = v.data.position;
    if (v.data.assigneeId !== undefined) {
      const a = await db.user.findUnique({ where: { id: v.data.assigneeId } });
      if (!a || a.organizationId !== session.orgId) return badRequest("assignee-not-in-org");
      data.assigneeId = v.data.assigneeId;
    }
    const updated = await db.assignmentRule.update({ where: { id }, data });
    return ok({ rule: updated });
  } catch (e) {
    return serverError("assignment-rule-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot delete assignment rules");
    const { id } = await ctx.params;
    const rule = await db.assignmentRule.findUnique({ where: { id } });
    if (!rule || rule.organizationId !== session.orgId) return notFound("rule");
    await db.assignmentRule.delete({ where: { id } });
    return ok({ ok: true });
  } catch (e) {
    return serverError("assignment-rule-delete-failed", e);
  }
}

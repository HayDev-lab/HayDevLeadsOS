import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, validate, parseJson } from "@/lib/leados/api";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.assignmentRule.findMany({
      where: { organizationId: session.orgId },
      include: { assignee: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: [{ enabled: "desc" }, { position: "asc" }],
    });
    return ok({ rows });
  } catch (e) {
    return apiError("assignment-rules-list-failed", e);
  }
}

const Create = z.object({
  name: z.string().min(1).max(80),
  sourceId: z.string().nullable().optional(),
  sourceType: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  assigneeId: z.string().min(1),
  enabled: z.boolean().default(true),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create assignment rules");
    const body = await parseJson(req);
    const v = validate(Create, body);
    if (!v.ok) return v.error;
    // validate assignee in org
    const assignee = await db.user.findUnique({ where: { id: v.value.assigneeId } });
    if (!assignee || assignee.organizationId !== session.orgId) return badRequest("assignee-not-in-org");
    const count = await db.assignmentRule.count({ where: { organizationId: session.orgId } });
    const rule = await db.assignmentRule.create({
      data: {
        organizationId: session.orgId,
        name: v.value.name,
        sourceId: v.value.sourceId ?? null,
        sourceType: v.value.sourceType ?? null,
        priority: v.value.priority ?? null,
        assigneeId: v.value.assigneeId,
        enabled: v.value.enabled,
        position: count,
      },
    });
    return ok({ rule });
  } catch (e) {
    return apiError("assignment-rule-create-failed", e);
  }
}

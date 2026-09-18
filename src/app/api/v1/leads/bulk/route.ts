// Bulk operations on leads — assign owner, change stage, archive.
// All org-scoped; ids validated against the session org.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, notFound, apiError, validate, parseJson } from "@/lib/leados/api";
import { z } from "zod";
import { ACTIVITY_TYPE, LEAD_EVENT } from "@/lib/leados/constants";
import { publishEvent } from "@/lib/leados/events";
import { invalidateOrgCache } from "@/lib/leados/api-cache";
import { requireOrgMember, requireOrgStage } from "@/lib/leados/tenant-guard";

const BulkAction = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["assign", "stage", "archive", "priority"]),
  ownerId: z.string().optional(),
  stageId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot perform bulk actions");
    const body = await parseJson(req);
    const v = validate(BulkAction, body);
    if (!v.ok) return v.error;

    const { ids, action } = v.value;
    // fetch leads within org
    const leads = await db.lead.findMany({ where: { id: { in: ids }, organizationId: session.orgId }, select: { id: true, ownerId: true, stageId: true, priority: true, status: true } });
    if (!leads.length) return badRequest("no-leads-in-org");

    let updated = 0;
    const now = new Date();

    if (action === "archive") {
      const res = await db.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { status: "ARCHIVED", archivedAt: now } });
      updated = res.count;
      for (const l of leads) {
        await db.activity.create({ data: { organizationId: session.orgId, leadId: l.id, userId: session.userId, type: ACTIVITY_TYPE.SYSTEM_EVENT, title: "Lead archived (bulk)" } });
        await publishEvent({ orgId: session.orgId, leadId: l.id, userId: session.userId, type: LEAD_EVENT.LEAD_ARCHIVED });
      }
    } else if (action === "assign") {
      if (!v.value.ownerId) return badRequest("ownerId-required");
      // TENANT GUARD (v0.19.2): owner must be an ACTIVE member of THIS org —
      // OrganizationMember is the source of truth (User.organizationId is a
      // cache pointer). Foreign owner → 404 (same as missing).
      try {
        await requireOrgMember(session.orgId, v.value.ownerId);
      } catch {
        return notFound("owner");
      }
      const owner = await db.user.findUnique({ where: { id: v.value.ownerId }, select: { name: true } });
      const res = await db.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { ownerId: v.value.ownerId } });
      updated = res.count;
      for (const l of leads) {
        await db.activity.create({ data: { organizationId: session.orgId, leadId: l.id, userId: session.userId, type: ACTIVITY_TYPE.ASSIGNMENT, title: `Bulk assigned to ${owner?.name ?? "member"}` } });
        await publishEvent({ orgId: session.orgId, leadId: l.id, userId: session.userId, type: LEAD_EVENT.LEAD_ASSIGNED, payload: { ownerId: v.value.ownerId, bulk: true } as never });
      }
    } else if (action === "stage") {
      if (!v.value.stageId) return badRequest("stageId-required");
      // TENANT GUARD (v0.19.2 §13): stage validated THROUGH its pipeline —
      // foreign stage → 404 (identical to missing).
      let stage: { id: string; name: string; pipelineId: string };
      try {
        stage = await requireOrgStage(session.orgId, v.value.stageId);
      } catch {
        return notFound("stage");
      }
      const res = await db.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { stageId: v.value.stageId, pipelineId: stage.pipelineId } });
      updated = res.count;
      for (const l of leads) {
        await db.activity.create({ data: { organizationId: session.orgId, leadId: l.id, userId: session.userId, type: ACTIVITY_TYPE.STAGE_CHANGE, title: `Bulk moved to ${stage.name}` } });
        await publishEvent({ orgId: session.orgId, leadId: l.id, userId: session.userId, type: LEAD_EVENT.STAGE_CHANGED, payload: { stageId: v.value.stageId, bulk: true } as never });
      }
    } else if (action === "priority") {
      if (!v.value.priority) return badRequest("priority-required");
      const res = await db.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { priority: v.value.priority } });
      updated = res.count;
      for (const l of leads) {
        await db.activity.create({ data: { organizationId: session.orgId, leadId: l.id, userId: session.userId, type: ACTIVITY_TYPE.SYSTEM_EVENT, title: `Bulk priority → ${v.value.priority}` } });
      }
    }

    invalidateOrgCache(session.orgId);
    return ok({ updated, total: leads.length });
  } catch (e) {
    return apiError("bulk-failed", e);
  }
}

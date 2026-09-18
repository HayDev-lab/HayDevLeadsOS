import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, validate, parseJson } from "@/lib/leados/api";
import { LeadUpdate } from "@/lib/schemas/lead";
import { updateLead, archiveLead } from "@/lib/leados/lead-service";
import { attachSlaToLeads, getFirstResponseMap, getSlaThresholds } from "@/lib/leados/sla-service";
import {
  attachFollowUpToLeads,
  getFollowUpConfig,
  getFollowUpTaskMap,
} from "@/lib/leados/followup-sla-service";
import {
  attachStageInactivityToLeads,
  getStageInactivityConfig,
} from "@/lib/leados/stage-inactivity-service";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({
      where: { id },
      include: {
        source: true,
        stage: { include: { pipeline: true } },
        owner: { select: { id: true, name: true, email: true, avatarColor: true } },
        leadTags: { include: { tag: true } },
        audits: true,
        scoreComponents: { orderBy: { createdAt: "asc" } },
        attributions: true,
        integrationSyncs: { orderBy: { createdAt: "desc" }, take: 5 },
        flags: { where: { resolvedAt: null } },
        customValues: { include: { field: true } },
      },
    });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    // All three SLA layers (single engines, grouped queries, settings read once)
    const slaThresholds = await getSlaThresholds(session.orgId);
    const followUpConfig = await getFollowUpConfig(session.orgId);
    const stageInactivityConfig = await getStageInactivityConfig(session.orgId);
    const firstResponseMap = await getFirstResponseMap(session.orgId, [lead.id]);
    const taskMap = await getFollowUpTaskMap(session.orgId, [lead.id]);
    const [withSla] = attachSlaToLeads([lead], slaThresholds, firstResponseMap);
    const [withFollowUp] = attachFollowUpToLeads([withSla], followUpConfig, taskMap, firstResponseMap);
    const [withStage] = attachStageInactivityToLeads([withFollowUp], stageInactivityConfig);
    return ok({ lead: withStage, slaConfig: slaThresholds, followUpConfig, stageInactivityConfig });
  } catch (e) {
    return apiError("lead-get-failed", e);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot mutate leads");
    const { id } = await ctx.params;
    const body = await parseJson(req);
    const v = validate(LeadUpdate, body);
    if (!v.ok) return v.error;
    const updated = await updateLead(session.orgId, id, session.userId, v.value);
    return ok({ lead: updated });
  } catch (e) {
    const m = (e as Error).message;
    if (m === "LEAD_NOT_FOUND") return notFound("lead");
    if (m === "STAGE_NOT_FOUND") return notFound("stage");
    return apiError("lead-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot archive leads");
    const { id } = await ctx.params;
    const archived = await archiveLead(session.orgId, id, session.userId);
    return ok({ lead: archived });
  } catch (e) {
    if ((e as Error).message === "LEAD_NOT_FOUND") return notFound("lead");
    return apiError("lead-archive-failed", e);
  }
}

import { NextResponse } from "next/server";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, validate, parseJson } from "@/lib/leados/api";
import { StageChange } from "@/lib/schemas/lead";
import { changeStage } from "@/lib/leados/lead-service";
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot change stages");
    const { id } = await ctx.params;
    const body = await parseJson(req);
    const v = validate(StageChange, body);
    if (!v.ok) return v.error;
    const lead = await changeStage(session.orgId, id, session.userId, v.value.stageId);
    // Same SLA layers as the lead detail route (Section 38: the API returns
    // computed state — the frontend never re-implements business logic).
    const [withSla] = attachSlaToLeads([lead], await getSlaThresholds(session.orgId), await getFirstResponseMap(session.orgId, [lead.id]));
    const [withFollowUp] = attachFollowUpToLeads([withSla], await getFollowUpConfig(session.orgId), await getFollowUpTaskMap(session.orgId, [lead.id]), await getFirstResponseMap(session.orgId, [lead.id]));
    const [withStage] = attachStageInactivityToLeads([withFollowUp], await getStageInactivityConfig(session.orgId));
    return ok({ lead: withStage });
  } catch (e) {
    const m = (e as Error).message;
    if (m === "LEAD_NOT_FOUND") return notFound("lead");
    if (m === "STAGE_NOT_FOUND") return notFound("stage");
    return apiError("stage-change-failed", e);
  }
}

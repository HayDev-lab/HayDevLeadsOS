import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import {
  getDashboardMetrics,
  getLeadsBySource,
  getConversionByStage,
  getRecentLeads,
  getOverdueTasks,
  getActivityStream,
  getAttentionSummary,
  getUrgentUnassigned,
  getAttentionQueue,
} from "@/lib/leados/dashboard-service";

export async function GET() {
  try {
    const session = await getSession();
    const [metrics, bySource, byStage, recent, overdueTasks, activity, attention, urgentUnassigned, slaAttention] = await Promise.all([
      getDashboardMetrics(session.orgId, session.organization.timezone),
      getLeadsBySource(session.orgId),
      getConversionByStage(session.orgId),
      getRecentLeads(session.orgId, 8),
      getOverdueTasks(session.orgId, 10),
      getActivityStream(session.orgId, 14),
      getAttentionSummary(session.orgId, 10),
      getUrgentUnassigned(session.orgId),
      getAttentionQueue(session.orgId),
    ]);
    return ok({ metrics, bySource, byStage, recent, overdueTasks, activity, attention, urgentUnassigned, slaAttention });
  } catch (e) {
    return apiError("dashboard-failed", e);
  }
}

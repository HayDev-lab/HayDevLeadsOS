import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, serverError } from "@/lib/leados/api";
import {
  getDashboardMetrics,
  getLeadsBySource,
  getConversionByStage,
  getRecentLeads,
  getOverdueTasks,
  getActivityStream,
  getAttentionSummary,
  getUrgentUnassigned,
} from "@/lib/leados/dashboard-service";

export async function GET() {
  try {
    const session = await getSession();
    const [metrics, bySource, byStage, recent, overdueTasks, activity, attention, urgentUnassigned] = await Promise.all([
      getDashboardMetrics(session.orgId, session.organization.timezone),
      getLeadsBySource(session.orgId),
      getConversionByStage(session.orgId),
      getRecentLeads(session.orgId, 8),
      getOverdueTasks(session.orgId, 10),
      getActivityStream(session.orgId, 14),
      getAttentionSummary(session.orgId, 10),
      getUrgentUnassigned(session.orgId),
    ]);
    return ok({ metrics, bySource, byStage, recent, overdueTasks, activity, attention, urgentUnassigned });
  } catch (e) {
    return serverError("dashboard-failed", e);
  }
}

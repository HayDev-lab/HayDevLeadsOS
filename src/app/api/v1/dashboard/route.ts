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
import { cached } from "@/lib/leados/api-cache";

export async function GET() {
  try {
    const session = await getSession();
    const orgId = session.orgId;
    const tz = session.organization.timezone;
    // Nine aggregate queries per dashboard visit — cached 45s (shorter than
    // analytics: the dashboard is the "live" surface), invalidated eagerly on
    // any lead/task mutation via invalidateOrgCache().
    const data = await cached(`dashboard:${orgId}`, 45_000, () =>
      (async () => {
        const [metrics, bySource, byStage, recent, overdueTasks, activity, attention, urgentUnassigned, slaAttention] = await Promise.all([
          getDashboardMetrics(orgId, tz),
          getLeadsBySource(orgId),
          getConversionByStage(orgId),
          getRecentLeads(orgId, 8),
          getOverdueTasks(orgId, 10),
          getActivityStream(orgId, 14),
          getAttentionSummary(orgId, 10),
          getUrgentUnassigned(orgId),
          getAttentionQueue(orgId),
        ]);
        return { metrics, bySource, byStage, recent, overdueTasks, activity, attention, urgentUnassigned, slaAttention };
      })()
    );
    return ok(data);
  } catch (e) {
    return apiError("dashboard-failed", e);
  }
}

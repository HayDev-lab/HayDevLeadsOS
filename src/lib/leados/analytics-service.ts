// Analytics service — deterministic metrics, no fake ROI.
import { db } from "@/lib/db";

export async function getAnalytics(orgId: string) {
  const [totalLeads, wonCount, lostCount, archivedCount] = await Promise.all([
    db.lead.count({ where: { organizationId: orgId, status: { notIn: ["ARCHIVED"] } } }),
    db.lead.count({ where: { organizationId: orgId, status: "WON" } }),
    db.lead.count({ where: { organizationId: orgId, status: "LOST" } }),
    db.lead.count({ where: { organizationId: orgId, status: "ARCHIVED" } }),
  ]);
  const conversionRate = totalLeads > 0 ? Math.round((wonCount / totalLeads) * 100) : 0;

  // Avg response time: time between lead.createdAt and the first inbound activity of type CALL/MESSAGE/EMAIL/FOLLOW_UP
  // Use first activity timestamp per lead.
  const leads = await db.lead.findMany({
    where: { organizationId: orgId, status: { notIn: ["ARCHIVED"] } },
    select: { id: true, createdAt: true },
    take: 500,
  });
  let totalRespMs = 0;
  let respCount = 0;
  for (const l of leads) {
    const firstAct = await db.activity.findFirst({
      where: { leadId: l.id, type: { in: ["CALL", "MESSAGE", "EMAIL", "FOLLOW_UP"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (firstAct) {
      const diff = new Date(firstAct.createdAt).getTime() - new Date(l.createdAt).getTime();
      if (diff > 0) { totalRespMs += diff; respCount++; }
    }
  }
  const avgResponseHours = respCount > 0 ? Math.round((totalRespMs / respCount / 3600000) * 10) / 10 : null;

  // Wins by source
  const winsBySourceRaw = await db.lead.findMany({
    where: { organizationId: orgId, status: "WON" },
    include: { source: { select: { name: true, type: true } } },
  });
  const winsBySourceMap = new Map<string, { name: string; count: number; value: number }>();
  for (const l of winsBySourceRaw) {
    const key = l.source?.type ?? "unknown";
    const existing = winsBySourceMap.get(key) ?? { name: l.source?.name ?? key, count: 0, value: 0 };
    existing.count++;
    existing.value += l.estimatedValue ?? 0;
    winsBySourceMap.set(key, existing);
  }
  const winsBySource = Array.from(winsBySourceMap.entries()).map(([type, v]) => ({ type, ...v }));

  // Lost reasons — count by lostReason
  const lostLeads = await db.lead.findMany({
    where: { organizationId: orgId, status: "LOST" },
    select: { lostReason: true },
  });
  const lostReasonsMap = new Map<string, number>();
  for (const l of lostLeads) {
    const k = l.lostReason || "Unspecified";
    lostReasonsMap.set(k, (lostReasonsMap.get(k) ?? 0) + 1);
  }
  const lostReasons = Array.from(lostReasonsMap.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

  // Leads received over last 7 days (simple time series)
  const days: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(Date.now() - i * 86400000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const count = await db.lead.count({ where: { organizationId: orgId, createdAt: { gte: start, lt: end } } });
    days.push({ date: start.toISOString().slice(0, 10), count });
  }

  // Leads by stage (funnel)
  const stages = await db.pipelineStage.findMany({
    where: { pipeline: { organizationId: orgId, isDefault: true } },
    orderBy: { position: "asc" },
  });
  const stageCounts = await db.lead.groupBy({
    by: ["stageId"],
    where: { organizationId: orgId, status: { notIn: ["ARCHIVED"] } },
    _count: { _all: true },
  });
  const stageValue = await db.lead.groupBy({
    by: ["stageId"],
    where: { organizationId: orgId, status: { notIn: ["ARCHIVED"] } },
    _sum: { estimatedValue: true },
  });
  const stageMap = new Map(stageCounts.filter((r) => r.stageId).map((r) => [r.stageId, r._count._all]));
  const valueMap = new Map(stageValue.filter((r) => r.stageId).map((r) => [r.stageId, r._sum.estimatedValue ?? 0]));
  const funnel = stages.map((s) => ({ stage: s.name, type: s.type, color: s.color, count: stageMap.get(s.id) ?? 0, value: valueMap.get(s.id) ?? 0 }));

  // Estimated total pipeline value (open leads only)
  const openValueRaw = await db.lead.aggregate({
    where: { organizationId: orgId, status: { notIn: ["WON", "LOST", "ARCHIVED"] } },
    _sum: { estimatedValue: true },
  });
  const wonValueRaw = await db.lead.aggregate({
    where: { organizationId: orgId, status: "WON" },
    _sum: { estimatedValue: true },
  });

  // Source ROI — leads count, won count, conversion, value per source
  const sourceLeads = await db.lead.groupBy({
    by: ["sourceId"],
    where: { organizationId: orgId, status: { notIn: ["ARCHIVED"] } },
    _count: { _all: true },
  });
  const sourceWon = await db.lead.groupBy({
    by: ["sourceId"],
    where: { organizationId: orgId, status: "WON" },
    _count: { _all: true },
  });
  const sourceLost = await db.lead.groupBy({
    by: ["sourceId"],
    where: { organizationId: orgId, status: "LOST" },
    _count: { _all: true },
  });
  const sourceValue = await db.lead.groupBy({
    by: ["sourceId"],
    where: { organizationId: orgId, status: "WON" },
    _sum: { estimatedValue: true },
  });
  const allSources = await db.leadSource.findMany({ where: { organizationId: orgId } });
  const sourceMap = new Map(allSources.map((s) => [s.id, s]));
  const sourceRoiMap = new Map<string, { type: string; name: string; count: number; won: number; lost: number; value: number; conversion: number }>();
  for (const r of sourceLeads) {
    if (!r.sourceId) continue;
    const src = sourceMap.get(r.sourceId);
    if (!src) continue;
    sourceRoiMap.set(r.sourceId, { type: src.type, name: src.name, count: r._count._all, won: 0, lost: 0, value: 0, conversion: 0 });
  }
  for (const r of sourceWon) {
    if (!r.sourceId) continue;
    const entry = sourceRoiMap.get(r.sourceId);
    if (entry) entry.won = r._count._all;
  }
  for (const r of sourceLost) {
    if (!r.sourceId) continue;
    const entry = sourceRoiMap.get(r.sourceId);
    if (entry) entry.lost = r._count._all;
  }
  for (const r of sourceValue) {
    if (!r.sourceId) continue;
    const entry = sourceRoiMap.get(r.sourceId);
    if (entry) entry.value = r._sum.estimatedValue ?? 0;
  }
  for (const entry of sourceRoiMap.values()) {
    entry.conversion = entry.count > 0 ? Math.round((entry.won / entry.count) * 100) : 0;
  }
  const sourceRoi = Array.from(sourceRoiMap.values()).sort((a, b) => b.count - a.count);

  return {
    totalLeads,
    won: wonCount,
    lost: lostCount,
    archived: archivedCount,
    conversionRate,
    avgResponseHours,
    winsBySource,
    lostReasons,
    days,
    funnel,
    openPipelineValue: openValueRaw._sum.estimatedValue ?? 0,
    wonValue: wonValueRaw._sum.estimatedValue ?? 0,
    sourceRoi,
  };
}

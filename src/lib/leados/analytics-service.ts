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

  // 30-day trend for the heatmap
  const trend30: { date: string; count: number; won: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const start = new Date(Date.now() - i * 86400000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const [count, won] = await Promise.all([
      db.lead.count({ where: { organizationId: orgId, createdAt: { gte: start, lt: end } } }),
      db.lead.count({ where: { organizationId: orgId, status: "WON", updatedAt: { gte: start, lt: end } } }),
    ]);
    trend30.push({ date: start.toISOString().slice(0, 10), count, won });
  }

  // Response time distribution (buckets)
  const respBuckets = { "0-1h": 0, "1-4h": 0, "4-24h": 0, "1-3d": 0, "3d+": 0, "none": 0 };
  for (const l of leads) {
    const firstAct = await db.activity.findFirst({
      where: { leadId: l.id, type: { in: ["CALL", "MESSAGE", "EMAIL", "FOLLOW_UP"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (!firstAct) { respBuckets.none++; continue; }
    const diffH = (new Date(firstAct.createdAt).getTime() - new Date(l.createdAt).getTime()) / 3600000;
    if (diffH < 0) { respBuckets.none++; continue; }
    if (diffH <= 1) respBuckets["0-1h"]++;
    else if (diffH <= 4) respBuckets["1-4h"]++;
    else if (diffH <= 24) respBuckets["4-24h"]++;
    else if (diffH <= 72) respBuckets["1-3d"]++;
    else respBuckets["3d+"]++;
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

  // ---------------------------------------------------------------------------
  // REVENUE FORECAST — stage-weighted pipeline (v0.18).
  // Win probability per OPEN stage is computed EMPIRICALLY from stage history:
  // p(S) = won-after-reaching-S / resolved-after-reaching-S (min 2 samples).
  // Stages without enough history fall back to a position-based estimate and
  // are flagged `empirical: false` — the UI never presents estimates as facts.
  // ---------------------------------------------------------------------------
  const stageChangeActs = await db.activity.findMany({
    where: { organizationId: orgId, type: "STAGE_CHANGE" },
    select: { leadId: true, metadata: true },
  });
  // leadId -> set of stageIds the lead ever occupied (from transition history)
  const leadStages = new Map<string, Set<string>>();
  const addReached = (leadId: string, stageId: string) => {
    let s = leadStages.get(leadId);
    if (!s) {
      s = new Set();
      leadStages.set(leadId, s);
    }
    s.add(stageId);
  };
  for (const a of stageChangeActs) {
    const to = (a.metadata as { to?: string } | null)?.to;
    if (to) addReached(a.leadId, to);
  }
  // Resolved leads: which open stages did they pass through before resolving?
  const resolvedLeads = await db.lead.findMany({
    where: { organizationId: orgId, status: { in: ["WON", "LOST"] } },
    select: { id: true, status: true },
  });
  // Open leads currently parked at each stage (value exposed to forecast)
  const openLeads = await db.lead.findMany({
    where: { organizationId: orgId, status: { notIn: ["WON", "LOST", "ARCHIVED"] } },
    select: { id: true, stageId: true, estimatedValue: true },
  });
  for (const l of openLeads) if (l.stageId) addReached(l.id, l.stageId);

  const openStages = stages.filter((s) => !s.isWon && !s.isLost);
  const forecastStages = openStages.map((s, idx) => {
    const reachedCount = { won: 0, lost: 0 };
    for (const rl of resolvedLeads) {
      const reached = leadStages.get(rl.id);
      if (!reached || !reached.has(s.id)) continue;
      if (rl.status === "WON") reachedCount.won++;
      else reachedCount.lost++;
    }
    const resolvedHere = reachedCount.won + reachedCount.lost;
    const empirical = resolvedHere >= 2;
    // Position-based fallback: even progression across open stages (14%..86%
    // for 6 stages). Flagged as an estimate — never shown as a historical fact.
    const probability = empirical
      ? Math.round((reachedCount.won / resolvedHere) * 100)
      : Math.round(((idx + 1) / (openStages.length + 1)) * 100);
    const count = stageMap.get(s.id) ?? 0;
    const value = valueMap.get(s.id) ?? 0;
    return {
      stage: s.name,
      color: s.color,
      count,
      value,
      probability,
      empirical,
      resolvedSamples: resolvedHere,
      weightedValue: Math.round((value * probability) / 100),
    };
  });
  const weightedTotal = forecastStages.reduce((a, x) => a + x.weightedValue, 0);
  const bestCase = forecastStages.reduce((a, x) => a + x.value, 0);
  const commit = forecastStages.filter((x) => x.probability >= 60).reduce((a, x) => a + x.weightedValue, 0);
  const empiricalStages = forecastStages.filter((x) => x.empirical).length;

  // WEEKLY-WON RUN-RATE (v0.19): how fast revenue is actually landing.
  // 7-day figure is the live pulse; the 30-day→per-week average is the
  // smoother signal (a single big win in the last 7 days shouldn't read
  // as the new normal).
  const nowMs = Date.now();
  const since7 = new Date(nowMs - 7 * 86400000);
  const since30 = new Date(nowMs - 30 * 86400000);
  const [won7, won30] = await Promise.all([
    db.lead.aggregate({
      where: { organizationId: orgId, status: "WON", updatedAt: { gte: since7 } },
      _count: { _all: true },
      _sum: { estimatedValue: true },
    }),
    db.lead.aggregate({
      where: { organizationId: orgId, status: "WON", updatedAt: { gte: since30 } },
      _count: { _all: true },
      _sum: { estimatedValue: true },
    }),
  ]);
  const runRate = {
    last7Wins: won7._count._all,
    last7Value: won7._sum.estimatedValue ?? 0,
    // 30-day window scaled to a week (7/30) — the headline figure.
    weeklyValue: Math.round(((won30._sum.estimatedValue ?? 0) * 7) / 30),
    weeklyCount: Math.round(((won30._count._all * 7) / 30) * 10) / 10,
  };

  const forecast = {
    stages: forecastStages,
    weightedTotal,
    bestCase,
    commit,
    // How much of the forecast rests on real history vs. position estimates.
    empiricalCoverage: openStages.length > 0 ? Math.round((empiricalStages / openStages.length) * 100) : 0,
    runRate,
  };

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
    trend30,
    respBuckets,
    funnel,
    forecast,
    openPipelineValue: openValueRaw._sum.estimatedValue ?? 0,
    wonValue: wonValueRaw._sum.estimatedValue ?? 0,
    sourceRoi,
  };
}

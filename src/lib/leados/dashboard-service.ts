// Dashboard service — aggregates metrics for the LeadOS dashboard.
// Deterministic counts; no fake ROI.

import { db } from "@/lib/db";
import { PRIORITY } from "./constants";
import { countSlaBreached, getSlaThresholds, getFirstResponseMap, slaFilterWhere } from "./sla-service";
import {
  countFollowUpsDueToday,
  countFollowUpsOverdue,
  followUpFilterWhere,
  getFollowUpConfig,
  getFollowUpTaskMap,
} from "./followup-sla-service";
import {
  asEngineConfig,
  countStaleDeals,
  getStageInactivityConfig,
  stageHealthFilterWhere,
} from "./stage-inactivity-service";
import { SLA_STATUS, computeFirstResponseSla } from "@/lib/sla";
import { FOLLOWUP_SLA_STATUS, computeFollowUpSla } from "@/lib/sla-followup";
import { STAGE_INACTIVITY_STATUS, computeStageInactivity } from "@/lib/sla-stage-inactivity";

export interface DashboardMetrics {
  newLeads: number;
  unassigned: number;
  overdueFollowups: number;
  qualified: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
  totalActive: number;
  slaBreached: number;
  /** Follow-ups due today (earliest open follow-up task due within today, org tz). */
  followUpsDueToday: number;
  /** Tasks (any type) due today and still open. */
  tasksDueToday: number;
  /** Meetings logged today. */
  meetingsToday: number;
  /** STAGE INACTIVITY: deals whose current-stage age passed the stage threshold. */
  staleDeals: number;
}

export async function getDashboardMetrics(orgId: string, timezone = "Asia/Yerevan"): Promise<DashboardMetrics> {
  const now = new Date();
  const where = { organizationId: orgId };
  // "Today" boundaries in the org timezone; storage stays UTC.
  const dayStartUtc = new Date(now.getTime() - tzOffsetMinutes(timezone, now) * 60_000);
  dayStartUtc.setUTCHours(0, 0, 0, 0);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 3_600_000);

  const [
    newLeads,
    unassigned,
    qualified,
    meetings,
    proposals,
    won,
    lost,
    totalActive,
    slaBreached,
    followUpsOverdue,
    followUpsDueToday,
    tasksDueToday,
    meetingsToday,
    staleDeals,
  ] = await Promise.all([
    db.lead.count({ where: { ...where, status: "NEW" } }),
    db.lead.count({ where: { ...where, ownerId: null, status: { notIn: ["WON", "LOST", "ARCHIVED"] } } }),
    db.lead.count({ where: { ...where, status: "QUALIFIED" } }),
    db.lead.count({ where: { ...where, stage: { name: "Meeting" } } }),
    db.lead.count({ where: { ...where, stage: { name: "Proposal" } } }),
    db.lead.count({ where: { ...where, status: "WON" } }),
    db.lead.count({ where: { ...where, status: "LOST" } }),
    db.lead.count({ where: { ...where, status: { notIn: ["ARCHIVED"] } } }),
    countSlaBreached(orgId),
    // REAL follow-up SLA counts (KPI click == filter count by construction).
    countFollowUpsOverdue(orgId),
    countFollowUpsDueToday(orgId, timezone),
    db.task.count({
      where: { organizationId: orgId, status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { gte: dayStartUtc, lt: dayEndUtc } },
    }),
    db.activity.count({ where: { organizationId: orgId, type: "MEETING", createdAt: { gte: dayStartUtc, lt: dayEndUtc } } }),
    // REAL stage inactivity count (KPI click == ?stageHealth=STALE filter count).
    countStaleDeals(orgId),
  ]);

  return {
    newLeads,
    unassigned,
    // Rewired to the FOLLOW-UP SLA engine (real overdue follow-up tasks).
    overdueFollowups: followUpsOverdue,
    qualified,
    meetings,
    proposals,
    won,
    lost,
    totalActive,
    slaBreached,
    followUpsDueToday,
    tasksDueToday,
    meetingsToday,
    staleDeals,
  };
}

// ---------------------------------------------------------------------------
// NEEDS ATTENTION — shared PRESENTATION layer over the three INDEPENDENT
// engines (Sections 61-67). Counts issues, not leads: one lead may carry two
// or three problems at once. Never merges engine business logic.
// ---------------------------------------------------------------------------

export type AttentionIssueKind = "FIRST_RESPONSE" | "FOLLOW_UP" | "STAGE_INACTIVITY";
export type AttentionSeverity = "CRITICAL" | "WARNING";

export interface AttentionIssue {
  kind: AttentionIssueKind;
  severity: AttentionSeverity;
  /** Minutes over/past the deadline (magnitude, used for ordering). */
  overdueMinutes: number | null;
}

export interface AttentionQueueItem {
  leadId: string;
  leadName: string;
  issues: AttentionIssue[];
}

export interface AttentionQueue {
  counts: {
    /** Leads with first-response BREACH (unanswered too long). */
    firstResponseBreached: number;
    /** Leads with follow-up OVERDUE. */
    followUpsOverdue: number;
    /** Leads with STALE stage health. */
    staleDeals: number;
    /** Sum of the three (a lead with 2 problems counts twice). */
    totalIssues: number;
    /** DISTINCT leads carrying at least one issue. */
    leadsWithIssues: number;
  };
  /** Top critical leads for the dashboard preview (max 5). */
  items: AttentionQueueItem[];
}

/**
 * Aggregate the three SLA layers into the Needs-Attention work queue.
 * Counts are computed with the same server-side filters the Lead List uses
 * (KPI click == filter count by construction), then the top leads are ranked
 * by issue count and magnitude for the compact preview.
 */
export async function getAttentionQueue(orgId: string): Promise<AttentionQueue> {
  const slaThresholds = await getSlaThresholds(orgId);
  const followUpConfig = await getFollowUpConfig(orgId);
  const stageConfig = await getStageInactivityConfig(orgId);

  const [frRows, fuRows, staleRows] = await Promise.all([
    db.lead.findMany({
      where: { organizationId: orgId, ...slaFilterWhere(SLA_STATUS.BREACH, slaThresholds) },
      select: { id: true },
    }),
    db.lead.findMany({
      where: { organizationId: orgId, ...followUpFilterWhere(FOLLOWUP_SLA_STATUS.OVERDUE, followUpConfig.warningBeforeHours) },
      select: { id: true },
    }),
    db.lead.findMany({
      where: { organizationId: orgId, ...stageHealthFilterWhere(STAGE_INACTIVITY_STATUS.STALE, stageConfig) },
      select: { id: true },
    }),
  ]);

  const firstResponse = new Set(frRows.map((l) => l.id));
  const followUp = new Set(fuRows.map((l) => l.id));
  const stale = new Set(staleRows.map((l) => l.id));
  const union = new Set([...firstResponse, ...followUp, ...stale]);

  const counts = {
    firstResponseBreached: firstResponse.size,
    followUpsOverdue: followUp.size,
    staleDeals: stale.size,
    totalIssues: firstResponse.size + followUp.size + stale.size,
    leadsWithIssues: union.size,
  };
  if (union.size === 0) return { counts, items: [] };

  // Hydrate the affected leads (bounded — only leads with issues) and
  // compute every layer once with the SAME single engines.
  const leads = await db.lead.findMany({
    where: { organizationId: orgId, id: { in: [...union] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      createdAt: true,
      status: true,
      stageId: true,
      stageEnteredAt: true,
      stage: { select: { type: true } },
    },
    take: 100,
  });
  const firstResponseMap = await getFirstResponseMap(orgId, leads.map((l) => l.id));
  const taskMap = await getFollowUpTaskMap(orgId, leads.map((l) => l.id));
  const engineStageConfig = asEngineConfig(stageConfig);
  const now = new Date();

  const items: AttentionQueueItem[] = leads
    .map((l) => {
      const issues: AttentionIssue[] = [];
      const responded = firstResponseMap.get(l.id) ?? null;
      const sla = computeFirstResponseSla({ createdAt: l.createdAt, firstResponseAt: responded }, slaThresholds, now);
      if (sla.status === SLA_STATUS.BREACH) {
        issues.push({ kind: "FIRST_RESPONSE", severity: "CRITICAL", overdueMinutes: sla.elapsedMinutes });
      }
      const pair = taskMap.get(l.id) ?? { open: null, lastCompleted: null };
      const fu = computeFollowUpSla(
        { leadStatus: l.status, firstResponseAt: responded, openTask: pair.open, lastCompleted: pair.lastCompleted },
        followUpConfig,
        now
      );
      if (fu.status === FOLLOWUP_SLA_STATUS.OVERDUE) {
        issues.push({ kind: "FOLLOW_UP", severity: "CRITICAL", overdueMinutes: fu.overdueMinutes ?? 0 });
      }
      const si = computeStageInactivity(
        {
          leadStatus: l.status,
          stageId: l.stageId,
          stageType: l.stage?.type ?? null,
          stageEnteredAt: l.stageEnteredAt,
          createdAt: l.createdAt,
        },
        engineStageConfig,
        now
      );
      if (si.status === STAGE_INACTIVITY_STATUS.STALE) {
        issues.push({ kind: "STAGE_INACTIVITY", severity: "CRITICAL", overdueMinutes: si.overdueMinutes ?? 0 });
      }
      return {
        leadId: l.id,
        leadName: l.company || [l.firstName, l.lastName].filter(Boolean).join(" ") || "Lead",
        issues,
      };
    })
    .filter((l) => l.issues.length > 0);

  // Presentation priority (Section 114): most issues first, then the largest
  // overdue magnitude. This is NOT a new business priority field.
  const magnitude = (i: AttentionQueueItem) => Math.max(0, ...i.issues.map((x) => x.overdueMinutes ?? 0));
  items.sort((a, b) => b.issues.length - a.issues.length || magnitude(b) - magnitude(a));

  return { counts, items: items.slice(0, 5) };
}

/** Offset of a timezone from UTC in minutes (positive = east of UTC) at `at`. */
function tzOffsetMinutes(timezone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(at).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour === "24" ? "0" : parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

export async function getLeadsBySource(orgId: string) {
  const sources = await db.leadSource.findMany({ where: { organizationId: orgId }, orderBy: { position: "asc" } });
  const rows = await db.lead.groupBy({
    by: ["sourceId"],
    where: { organizationId: orgId, status: { notIn: ["ARCHIVED"] } },
    _count: { _all: true },
  });
  const map = new Map(rows.filter((r) => r.sourceId).map((r) => [r.sourceId, r._count._all]));
  return sources.map((s) => ({ source: s.name, type: s.type, count: map.get(s.id) ?? 0 }));
}

export async function getConversionByStage(orgId: string) {
  const stages = await db.pipelineStage.findMany({
    where: { pipeline: { organizationId: orgId, isDefault: true } },
    orderBy: { position: "asc" },
  });
  const rows = await db.lead.groupBy({
    by: ["stageId"],
    where: { organizationId: orgId, status: { notIn: ["ARCHIVED"] } },
    _count: { _all: true },
  });
  const map = new Map(rows.filter((r) => r.stageId).map((r) => [r.stageId, r._count._all]));
  return stages.map((s) => ({ stage: s.name, type: s.type, count: map.get(s.id) ?? 0, color: s.color }));
}

export async function getRecentLeads(orgId: string, limit = 8) {
  return db.lead.findMany({
    where: { organizationId: orgId, status: { notIn: ["ARCHIVED"] } },
    include: { source: true, stage: true, owner: { select: { id: true, name: true, avatarColor: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getOverdueTasks(orgId: string, limit = 10) {
  return db.task.findMany({
    where: { organizationId: orgId, status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { lt: new Date() } },
    include: { lead: { select: { id: true, firstName: true, lastName: true, company: true } }, assignee: { select: { id: true, name: true, avatarColor: true } } },
    orderBy: { dueAt: "asc" },
    take: limit,
  });
}

export async function getActivityStream(orgId: string, limit = 12) {
  return db.activity.findMany({
    where: { organizationId: orgId },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, company: true } },
      user: { select: { id: true, name: true, avatarColor: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getAttentionSummary(orgId: string, limit = 12) {
  // leads with active flags — joined with lead + owner
  const flags = await db.lostLeadFlag.findMany({
    where: { organizationId: orgId, resolvedAt: null },
    include: { lead: { include: { owner: { select: { id: true, name: true } } } } },
    orderBy: { detectedAt: "desc" },
    take: limit * 2,
  });
  // de-duplicate by lead (keep most severe)
  const byLead = new Map<string, (typeof flags)[number]>();
  const sevRank = { critical: 3, warning: 2, info: 1 } as const;
  for (const f of flags) {
    const cur = byLead.get(f.leadId);
    if (!cur || sevRank[f.severity as keyof typeof sevRank] > sevRank[cur.severity as keyof typeof sevRank]) {
      byLead.set(f.leadId, f);
    }
  }
  return Array.from(byLead.values()).slice(0, limit);
}

export async function getUrgentUnassigned(orgId: string) {
  return db.lead.count({
    where: { organizationId: orgId, ownerId: null, priority: { in: [PRIORITY.URGENT, PRIORITY.HIGH] }, status: { notIn: ["WON", "LOST", "ARCHIVED"] } },
  });
}

// Lost Lead Detector service — runs the deterministic detector over the DB
// for an organization, persists flags (resolving stale ones), and returns them.

import { db } from "@/lib/db";
import { detectLeadFlags, type DetectedFlag } from "./lost-detector";
import { LOST_FLAG_REASON } from "./constants";

export interface DetectorRunResult {
  flags: DetectedFlag[];
  leadsNeedingAttention: number;
  byReason: Record<string, number>;
}

export async function runLostDetector(orgId: string): Promise<DetectorRunResult> {
  // active leads only (not won/lost/archived)
  const leads = await db.lead.findMany({
    where: { organizationId: orgId, status: { notIn: ["WON", "LOST", "ARCHIVED"] } },
    include: { stage: true },
    orderBy: { createdAt: "desc" },
  });

  // gather last activity timestamps in one query each
  const flags: DetectedFlag[] = [];
  for (const l of leads) {
    const lastAct = await db.activity.findFirst({
      where: { leadId: l.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const detected = detectLeadFlags({
      id: l.id,
      status: l.status,
      stageType: l.stage?.type ?? "open",
      stageName: l.stage?.name ?? null,
      ownerId: l.ownerId,
      priority: l.priority,
      createdAt: l.createdAt,
      lastContactAt: l.lastContactAt,
      lastActivityAt: lastAct?.createdAt ?? null,
      nextActionAt: l.nextActionAt,
    });
    flags.push(...detected);
  }

  // persist flags: resolve existing flags not detected this run, insert new ones
  const detectedLeadIds = Array.from(new Set(flags.map((f) => f.leadId)));
  await db.lostLeadFlag.updateMany({
    where: {
      organizationId: orgId,
      AND: [
        { leadId: { in: leads.map((l) => l.id) } },
        { resolvedAt: null },
        ...(detectedLeadIds.length ? [{ leadId: { notIn: detectedLeadIds } }] : []),
      ],
    },
    data: { resolvedAt: new Date() },
  }).catch(() => {});

  for (const f of flags) {
    // upsert (one unresolved flag per lead+reason)
    const existing = await db.lostLeadFlag.findFirst({
      where: { leadId: f.leadId, reason: f.reason, resolvedAt: null },
    });
    if (existing) {
      if (existing.severity !== f.severity || existing.message !== f.message) {
        await db.lostLeadFlag.update({ where: { id: existing.id }, data: { severity: f.severity, message: f.message, detectedAt: new Date() } });
      }
    } else {
      await db.lostLeadFlag.create({
        data: { organizationId: orgId, leadId: f.leadId, reason: f.reason, message: f.message, severity: f.severity },
      }).catch(() => {});
    }
  }

  // by reason
  const byReason: Record<string, number> = {};
  for (const f of flags) byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;

  return {
    flags,
    leadsNeedingAttention: new Set(flags.map((f) => f.leadId)).size,
    byReason,
  };
}

export async function getActiveFlags(orgId: string, leadId?: string) {
  return db.lostLeadFlag.findMany({
    where: { organizationId: orgId, resolvedAt: null, ...(leadId ? { leadId } : {}) },
    include: { lead: { select: { id: true, firstName: true, lastName: true, company: true, ownerId: true, owner: { select: { id: true, name: true } } } } },
    orderBy: { detectedAt: "desc" },
  });
}

export const FLAG_REASON_LABEL: Record<string, string> = {
  [LOST_FLAG_REASON.NO_CONTACT]: "lost.no_contact",
  [LOST_FLAG_REASON.OVERDUE_FOLLOWUP]: "lost.overdue_followup",
  [LOST_FLAG_REASON.NO_ACTIVITY]: "lost.no_activity",
  [LOST_FLAG_REASON.PROPOSAL_NO_FOLLOWUP]: "lost.proposal_no_followup",
  [LOST_FLAG_REASON.MEETING_NO_NEXT]: "lost.meeting_no_next",
  [LOST_FLAG_REASON.UNASSIGNED]: "lost.unassigned",
};

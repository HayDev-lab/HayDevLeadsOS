// HAYDEV LEADOS — EVENT RECONCILER (v0.14).
//
// Time-based problems (first-response breaches, follow-ups passing their
// deadline, deals going stale, tasks passing dueAt) do NOT happen during a
// user action — they happen because TIME PASSES. The reconciler is the sweep
// that detects them (spec Sections 20–27):
//
//   1. re-projects any unprocessed events (crash recovery),
//   2. loads ACTIVE leads + OPEN tasks + all three SLA configs ONCE,
//   3. computes every lead through the EXISTING engines —
//      computeFirstResponseSla / computeFollowUpSla / computeStageInactivity —
//      NO SLA logic is reimplemented here,
//   4. plans the missing events (pure planner in lib/domain-events.ts),
//   5. creates them idempotently (deterministic dedup keys + DB unique) and
//      projects notifications.
//
// Safe to run concurrently and repeatedly: a repeated run with unchanged
// state creates ZERO new events and ZERO new notifications.
//
// Batch guarantees: fixed number of queries regardless of lead count
// (leads + first-response groupBy + follow-up tasks + generic tasks + chunked
// dedup-key lookups) — no per-lead queries, no N+1.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  displayName,
  planLeadEvents,
  planTaskEvents,
  parseTaskEventConfig,
  type PlannedEvent,
  type TaskEventConfig,
} from "@/lib/domain-events";
import { computeFirstResponseSla, QUALIFYING_ACTIVITY_TYPES } from "@/lib/sla";
import { computeFollowUpSla } from "@/lib/sla-followup";
import { computeStageInactivity } from "@/lib/sla-stage-inactivity";
import { getSlaThresholds } from "./sla-service";
import { getFollowUpConfig, getFollowUpTaskMap } from "./followup-sla-service";
import { getStageInactivityConfig, asEngineConfig } from "./stage-inactivity-service";
import {
  getOrgFallbackRecipient,
  projectEventToNotifications,
  reprocessUnprocessedEvents,
  type PrefsCache,
} from "./domain-event-service";

export const TASK_EVENT_SETTING_KEY = "task_events";

export interface ReconciliationSummary {
  scannedLeads: number;
  scannedTasks: number;
  eventsCreated: number;
  notificationsCreated: number;
  duplicatesSkipped: number;
  reprocessed: number;
  durationMs: number;
}

/** Load the centralized task event config (Section 53 — one Setting, default 4h). */
export async function getTaskEventConfig(orgId: string): Promise<TaskEventConfig> {
  try {
    const row = await db.setting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: TASK_EVENT_SETTING_KEY } },
    });
    return parseTaskEventConfig(row?.value ?? null);
  } catch {
    return { warningBeforeHours: 4 };
  }
}

/** Chunk an array for IN-clause safety (SQLite parameter limits). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Run the reconciliation sweep for ONE organization (tenant-safe).
 * Idempotent: same state in → zero new events/notifications out.
 */
export async function runEventReconciliation(orgId: string, now: Date = new Date()): Promise<ReconciliationSummary> {
  const startedAt = Date.now();
  let eventsCreated = 0;
  let notificationsCreated = 0;
  let duplicatesSkipped = 0;

  // 0. Crash recovery (Sections 88–92): events created but never projected.
  const recovery = await reprocessUnprocessedEvents(orgId);
  notificationsCreated += recovery.notificationsCreated;

  // 1. Configs — one load each (existing caches serve the rest of the request).
  const [slaThresholds, followUpConfig, stageConfig, taskEventConfig, orgFallbackUserId] = await Promise.all([
    getSlaThresholds(orgId),
    getFollowUpConfig(orgId),
    getStageInactivityConfig(orgId),
    getTaskEventConfig(orgId),
    getOrgFallbackRecipient(orgId),
  ]);
  const stageEngineConfig = asEngineConfig(stageConfig);

  // 2. Active leads (final/archived are never monitored by any engine).
  const leads = await db.lead.findMany({
    where: { organizationId: orgId, status: { notIn: ["WON", "LOST", "ARCHIVED"] } },
    select: {
      id: true,
      createdAt: true,
      status: true,
      stageId: true,
      stageEnteredAt: true,
      ownerId: true,
      firstName: true,
      lastName: true,
      company: true,
      stage: { select: { type: true, name: true } },
    },
  });
  const leadIds = leads.map((l) => l.id);

  // 3. First-response map (ONE groupBy) + follow-up task map (TWO queries).
  const [firstResponseRaw, fuTaskMap] = await Promise.all([
    leadIds.length
      ? db.activity.groupBy({
          by: ["leadId"],
          where: {
            organizationId: orgId,
            leadId: { in: leadIds },
            type: { in: QUALIFYING_ACTIVITY_TYPES },
          },
          _min: { createdAt: true },
        })
      : Promise.resolve([] as { leadId: string; _min: { createdAt: Date | null } }[]),
    getFollowUpTaskMap(orgId, leadIds),
  ]);
  const firstResponseMap = new Map<string, Date>();
  for (const r of firstResponseRaw) {
    if (r._min.createdAt) firstResponseMap.set(r.leadId, r._min.createdAt);
  }

  // 4. Plan lead events (pure) through the EXISTING engines.
  const planned: PlannedEvent[] = [];
  for (const lead of leads) {
    const pair = fuTaskMap.get(lead.id) ?? { open: null, lastCompleted: null };
    planned.push(
      ...planLeadEvents(
        {
          id: lead.id,
          createdAt: lead.createdAt,
          status: lead.status,
          stageId: lead.stageId,
          stageType: lead.stage?.type ?? null,
          stageName: lead.stage?.name ?? null,
          stageEnteredAt: lead.stageEnteredAt,
          ownerId: lead.ownerId,
          leadName: displayName(lead),
          firstResponseAt: firstResponseMap.get(lead.id) ?? null,
        },
        {
          firstResponse: computeFirstResponseSla(
            { createdAt: lead.createdAt, firstResponseAt: firstResponseMap.get(lead.id) ?? null },
            slaThresholds,
            now
          ),
          followUp: computeFollowUpSla(
            {
              leadStatus: lead.status,
              firstResponseAt: firstResponseMap.get(lead.id) ?? null,
              openTask: pair.open,
              lastCompleted: pair.lastCompleted,
            },
            followUpConfig,
            now
          ),
          stageInactivity: computeStageInactivity(
            {
              leadStatus: lead.status,
              stageId: lead.stageId,
              stageType: lead.stage?.type ?? null,
              stageEnteredAt: lead.stageEnteredAt,
              createdAt: lead.createdAt,
            },
            stageEngineConfig,
            now
          ),
        },
        {
          followUpWarningBeforeHours: followUpConfig.warningBeforeHours,
          followUpAssigneeId: pair.open && "assignedTo" in pair.open ? (pair.open as { assignedTo?: string | null }).assignedTo ?? null : null,
        }
      )
    );
  }

  // 5. Generic tasks (Task.type = "TASK" only — follow-ups are handled above
  //    by the Follow-up engine, so a late follow-up never double-notifies).
  const genericTasks = await db.task.findMany({
    where: {
      organizationId: orgId,
      type: "TASK",
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueAt: { not: null },
    },
    include: { lead: { select: { id: true, firstName: true, lastName: true, company: true, ownerId: true } } },
  });
  for (const task of genericTasks) {
    planned.push(
      ...planTaskEvents(
        {
          id: task.id,
          title: task.title,
          dueAt: task.dueAt,
          status: task.status,
          type: task.type,
          assignedTo: task.assignedTo,
          leadId: task.leadId,
          leadName: task.lead ? displayName(task.lead) : null,
          leadOwnerId: task.lead?.ownerId ?? null,
        },
        taskEventConfig,
        now
      )
    );
  }

  // 6. Idempotent creation: check existing dedup keys in chunks, insert misses.
  if (planned.length) {
    const existing = new Set<string>();
    const keys = planned.map((p) => p.deduplicationKey);
    for (const part of chunk(keys, 800)) {
      const rows = await db.domainEvent.findMany({
        where: { organizationId: orgId, deduplicationKey: { in: part } },
        select: { deduplicationKey: true },
      });
      for (const r of rows) existing.add(r.deduplicationKey);
    }

    const prefsCache: PrefsCache = new Map();
    for (const p of planned) {
      if (existing.has(p.deduplicationKey)) {
        duplicatesSkipped++;
        continue;
      }
      const created = await db.domainEvent.create({
        data: {
          organizationId: orgId,
          type: p.type,
          entityType: p.entityType,
          entityId: p.entityId,
          occurredAt: p.occurredAt,
          payload: p.payload as Prisma.InputJsonValue,
          deduplicationKey: p.deduplicationKey,
        },
      }).catch(async (e: unknown) => {
        // Unique race: another runner created it first — treat as duplicate.
        if ((e as { code?: string })?.code === "P2002") return null;
        throw e;
      });
      if (!created) {
        duplicatesSkipped++;
        continue;
      }
      eventsCreated++;
      const projection = await projectEventToNotifications(created, { orgFallbackUserId, prefsCache });
      notificationsCreated += projection.notificationsCreated;
    }
  }

  const durationMs = Date.now() - startedAt;
  // Summary log (Section 87) — counts only, never sensitive payload.
  console.log(
    `[EVENT-RECONCILER] org=${orgId} scannedLeads=${leads.length} scannedTasks=${genericTasks.length} ` +
      `eventsCreated=${eventsCreated} notificationsCreated=${notificationsCreated} ` +
      `duplicatesSkipped=${duplicatesSkipped} reprocessed=${recovery.reprocessed} duration=${durationMs}ms`
  );
  return {
    scannedLeads: leads.length,
    scannedTasks: genericTasks.length,
    eventsCreated,
    notificationsCreated,
    duplicatesSkipped,
    reprocessed: recovery.reprocessed,
    durationMs,
  };
}

// Lead service — core operations: create, update, change stage, assign,
// archive, merge. Keeps duplicate detection, scoring, follow-up suggestion,
// events and audit trail coherent across all API routes.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client";
import {
  ACTIVITY_TYPE,
  LEAD_EVENT,
  LEAD_STATUS,
  PRIORITY,
  STAGE_TYPE,
} from "./constants";
import { normalizeEmail, normalizePhone } from "./normalize";
import { computeScore } from "./scoring";
import { suggestNextAction } from "./followup";
import { detectDuplicates, type DuplicateCheckResult } from "./duplicate";
import { publishEvent } from "./events";
import { recordAttribution } from "./attribution";
import { cancelFollowUpsForFinalStage } from "./followup-sla-service";
import {
  DOMAIN_EVENT,
  ENTITY_TYPE,
  displayName,
  leadAssignedDedupKey,
} from "@/lib/domain-events";
import { publishDomainEvent } from "./domain-event-service";
import {
  resolveAllLeadProblems,
  resolveStageNotifications,
} from "./notification-service";
import type { LeadCreateT, LeadUpdateT } from "@/lib/schemas/lead";

export interface CreateLeadInput extends LeadCreateT {
  // internal: bypass duplicate handling (when caller already checked)
  force?: boolean;
}

export interface CreateLeadResult {
  lead: Awaited<ReturnType<typeof db.lead.findUniqueOrThrow>>;
  duplicate?: DuplicateCheckResult;
  created: boolean;
}

async function recomputeScore(
  orgId: string,
  lead: { id: string; firstName?: string | null; lastName?: string | null; company?: string | null; phone?: string | null; email?: string | null; priority: string; estimatedValue?: number | null; sourceId?: string | null; stageId?: string | null; ownerId?: string | null },
  stageName?: string | null,
  auditData?: { automation: number; aiReadiness: number } | null
) {
  const rules = await db.scoringConfig.findMany({ where: { organizationId: orgId } });
  const source = lead.sourceId ? await db.leadSource.findUnique({ where: { id: lead.sourceId } }) : null;
  const result = computeScore(
    {
      audit: auditData,
      estimatedValue: lead.estimatedValue,
      priority: lead.priority,
      stageName: stageName ?? null,
      firstName: lead.firstName,
      lastName: lead.lastName,
      company: lead.company,
      phone: lead.phone,
      email: lead.email,
      sourceType: source?.type ?? null,
      hasMeetingRequestFlag: stageName === "Meeting" || stageName === "Proposal",
      hasBudgetFlag: (lead.estimatedValue ?? 0) > 0,
    },
    rules.map((r) => ({ key: r.key, label: r.label, points: r.points, enabled: r.enabled }))
  );
  await db.leadScoreComponent.deleteMany({ where: { leadId: lead.id } });
  await db.lead.update({ where: { id: lead.id }, data: { leadScore: result.score, scoreCategory: result.category } });
  for (const c of result.components) {
    await db.leadScoreComponent.create({ data: { leadId: lead.id, reason: c.reason, key: c.key, delta: c.delta } });
  }
  return result;
}

/** Emit a LEAD_ASSIGNED domain event (durable + projected notification).
 *  Same-assignee assignments never emit (spec Section 98). */
async function emitLeadAssigned(
  orgId: string,
  lead: { id: string; createdAt: Date; ownerId: string | null; firstName?: string | null; lastName?: string | null; company?: string | null },
  actorUserId: string | null
): Promise<void> {
  if (!lead.ownerId) return;
  const assignedAt = new Date();
  await publishDomainEvent(orgId, {
    type: DOMAIN_EVENT.LEAD_ASSIGNED,
    entityType: ENTITY_TYPE.LEAD,
    entityId: lead.id,
    actorUserId,
    occurredAt: assignedAt,
    deduplicationKey: leadAssignedDedupKey(lead.id, lead.ownerId, assignedAt),
    payload: {
      leadId: lead.id,
      leadName: displayName(lead),
      assigneeId: lead.ownerId,
      ownerId: lead.ownerId,
    },
  });
}

export async function createLead(
  orgId: string,
  userId: string | null,
  input: CreateLeadInput
): Promise<CreateLeadResult> {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);

  // duplicate check (unless forced). If a duplicate is found, do NOT create
  // silently — return the matches so the caller can prompt merge / open / force.
  let duplicate: DuplicateCheckResult | undefined;
  if (!input.force) {
    duplicate = await detectDuplicates(orgId, { phone, email, externalId: input.externalId });
    if (duplicate.hasDuplicates) {
      // Return without creating. Caller decides: open existing / merge / force-create.
      return { lead: null as unknown as CreateLeadResult["lead"], duplicate, created: false };
    }
  }

  // resolve source
  let sourceId = input.sourceId ?? null;
  if (!sourceId && input.sourceType) {
    const src = await db.leadSource.findFirst({ where: { organizationId: orgId, type: input.sourceType } });
    if (src) sourceId = src.id;
  }
  if (!sourceId) {
    const fallback = await db.leadSource.findFirst({ where: { organizationId: orgId, type: "manual" } });
    sourceId = fallback?.id ?? null;
  }

  // resolve stage
  let stageId = input.stageId ?? null;
  let pipelineId: string | null = null;
  if (!stageId) {
    const pipeline = await db.pipeline.findFirst({ where: { organizationId: orgId, isDefault: true } });
    if (pipeline) {
      pipelineId = pipeline.id;
      const first = await db.pipelineStage.findFirst({
        where: { pipelineId: pipeline.id },
        orderBy: { position: "asc" },
      });
      stageId = first?.id ?? null;
    }
  } else {
    const stage = await db.pipelineStage.findUnique({ where: { id: stageId }, include: { pipeline: true } });
    if (stage?.pipeline) pipelineId = stage.pipeline.id;
  }
  const stage = stageId ? await db.pipelineStage.findUnique({ where: { id: stageId } }) : null;

  const now = new Date();
  const nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : (stage ? suggestNextAction(stage.name, now).nextActionAt : null);
  const nextActionLabel = input.nextActionLabel ?? (stage ? suggestNextAction(stage.name, now).label : null);

  // Auto-assignment: if no explicit owner, check assignment rules
  let ownerId = input.ownerId ?? null;
  if (!ownerId) {
    ownerId = await resolveAutoAssignee(orgId, { sourceId, sourceType: input.sourceType, priority: input.priority ?? PRIORITY.MEDIUM });
  }

  const lead = await db.lead.create({
    data: {
      organizationId: orgId,
      externalId: input.externalId ?? null,
      sourceId,
      sourceDetail: input.sourceDetail ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      company: input.company ?? null,
      position: input.position ?? null,
      phone: input.phone ?? null,
      normalizedPhone: phone,
      email: input.email ?? null,
      normalizedEmail: email,
      preferredChannel: input.preferredChannel ?? null,
      locale: input.locale ?? null,
      status: LEAD_STATUS.NEW,
      pipelineId: pipelineId,
      stageId: stageId,
      ownerId: ownerId,
      priority: input.priority ?? PRIORITY.MEDIUM,
      estimatedValue: input.estimatedValue ?? null,
      currency: input.currency ?? null,
      summary: input.summary ?? null,
      requirements: input.requirements ?? null,
      nextActionAt,
      nextActionLabel,
      // STAGE INACTIVITY: entering the initial stage counts from creation.
      stageEnteredAt: new Date(),
    },
  });

  // tags
  if (input.tags?.length) {
    const existing = await db.tag.findMany({ where: { organizationId: orgId, name: { in: input.tags } } });
    const existingNames = new Set(existing.map((t) => t.name));
    const toCreate = input.tags.filter((t) => !existingNames.has(t));
    const created = await Promise.all(
      toCreate.map((name) =>
        db.tag.create({ data: { organizationId: orgId, name, color: "#64748b" } }).catch(() => null)
      )
    );
    const all = [...existing, ...created.filter(Boolean) as { id: string }[]];
    for (const t of all) {
      await db.leadTag.create({ data: { leadId: lead.id, tagId: t.id } }).catch(() => {});
    }
  }

  // attribution
  if (input.utm) {
    await recordAttribution(lead.id, input.sourceType ?? null, input.utm);
  }

  // initial note
  if (input.note) {
    await db.note.create({
      data: { organizationId: orgId, leadId: lead.id, userId, content: input.note },
    });
  }

  // recompute score
  await recomputeScore(orgId, lead, stage?.name ?? null);

  // events + activity
  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId: lead.id,
      userId,
      type: ACTIVITY_TYPE.SYSTEM_EVENT,
      title: "Lead created",
      description: `Created via ${input.sourceType ?? "manual"}`,
    },
  });
  await publishEvent({
    orgId,
    leadId: lead.id,
    userId,
    type: LEAD_EVENT.LEAD_CREATED,
    payload: { source: input.sourceType ?? "manual", stage: stage?.name } as Prisma.InputJsonValue,
  });
  if (input.ownerId) {
    await publishEvent({
      orgId,
      leadId: lead.id,
      userId,
      type: LEAD_EVENT.LEAD_ASSIGNED,
      payload: { ownerId: input.ownerId } as Prisma.InputJsonValue,
    });
  }

  // EVENT ENGINE: initial assignment is a business fact — notify the new owner.
  if (lead.ownerId) {
    await emitLeadAssigned(orgId, lead, userId);
  }

  const full = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { stage: true, source: true, owner: true } });
  return { lead: full, duplicate, created: true };
}

export async function updateLead(
  orgId: string,
  leadId: string,
  userId: string | null,
  input: LeadUpdateT
) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.organizationId !== orgId) throw new Error("LEAD_NOT_FOUND");

  // STAGE INACTIVITY: stage changes NEVER go through the generic update —
  // real transitions are delegated to changeStage (STAGE_CHANGE activity,
  // events, follow-up cancellation policy, stageEnteredAt reset). A stageId
  // equal to the current one is a no-op (timer must NOT reset, Section 20/50).
  const wantsStageChange = input.stageId != null && input.stageId !== lead.stageId;
  if (wantsStageChange) {
    const stage = await db.pipelineStage.findUnique({ where: { id: input.stageId! } });
    if (!stage) throw new Error("STAGE_NOT_FOUND");
  }

  const data: Prisma.LeadUpdateInput = {};
  if (input.firstName !== undefined) data.firstName = input.firstName ?? null;
  if (input.lastName !== undefined) data.lastName = input.lastName ?? null;
  if (input.company !== undefined) data.company = input.company ?? null;
  if (input.position !== undefined) data.position = input.position ?? null;
  if (input.phone !== undefined) {
    data.phone = input.phone ?? null;
    data.normalizedPhone = normalizePhone(input.phone);
  }
  if (input.email !== undefined) {
    data.email = input.email ?? null;
    data.normalizedEmail = normalizeEmail(input.email);
  }
  if (input.preferredChannel !== undefined) data.preferredChannel = input.preferredChannel ?? null;
  if (input.locale !== undefined) data.locale = input.locale ?? null;
  if (input.sourceDetail !== undefined) data.sourceDetail = input.sourceDetail ?? null;
  if (input.summary !== undefined) data.summary = input.summary ?? null;
  if (input.requirements !== undefined) data.requirements = input.requirements ?? null;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.estimatedValue !== undefined) data.estimatedValue = input.estimatedValue ?? null;
  if (input.currency !== undefined) data.currency = input.currency ?? null;
  if (input.lostReason !== undefined) data.lostReason = input.lostReason ?? null;
  if (input.lostNotes !== undefined) data.lostNotes = input.lostNotes ?? null;
  if (input.nextActionLabel !== undefined) data.nextActionLabel = input.nextActionLabel ?? null;
  if (input.nextActionAt !== undefined) data.nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : null;
  if (input.ownerId !== undefined) data.owner = input.ownerId ? { connect: { id: input.ownerId } } : { disconnect: true };
  if (input.sourceId !== undefined) data.source = input.sourceId ? { connect: { id: input.sourceId } } : { disconnect: true };
  // NOTE: stageId intentionally absent here — handled via changeStage below.

  const updated = await db.lead.update({ where: { id: leadId }, data });

  // tags sync
  if (input.tags !== undefined) {
    await db.leadTag.deleteMany({ where: { leadId } });
    if (input.tags.length) {
      const existing = await db.tag.findMany({ where: { organizationId: orgId, name: { in: input.tags } } });
      const existingNames = new Set(existing.map((t) => t.name));
      const created = await Promise.all(
        input.tags
          .filter((t) => !existingNames.has(t))
          .map((name) => db.tag.create({ data: { organizationId: orgId, name, color: "#64748b" } }).catch(() => null))
      );
      const all = [...existing, ...created.filter(Boolean) as { id: string }[]];
      for (const t of all) await db.leadTag.create({ data: { leadId, tagId: t.id } }).catch(() => {});
    }
  }

  // recompute score (est value / priority may have changed)
  await recomputeScore(orgId, updated, updated.stageId ? (await db.pipelineStage.findUnique({ where: { id: updated.stageId } }))?.name : null);

  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId,
      userId,
      type: ACTIVITY_TYPE.SYSTEM_EVENT,
      title: "Lead updated",
    },
  });

  // Real stage transitions run the FULL pipeline (activity, events, timer
  // reset, final-stage follow-up cancellation) — one code path for stage
  // changes, no silent bypasses.
  if (wantsStageChange) {
    await changeStage(orgId, leadId, userId, input.stageId!);
  }

  // EVENT ENGINE: owner changes emit LEAD_ASSIGNED (same owner → no event).
  if (input.ownerId != null && input.ownerId !== lead.ownerId) {
    await emitLeadAssigned(orgId, updated, userId);
  }

  return db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true, source: true, owner: true, leadTags: { include: { tag: true } } } });
}

export async function changeStage(
  orgId: string,
  leadId: string,
  userId: string | null,
  stageId: string
) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.organizationId !== orgId) throw new Error("LEAD_NOT_FOUND");
  const stage = await db.pipelineStage.findUnique({ where: { id: stageId } });
  if (!stage) throw new Error("STAGE_NOT_FOUND");

  // SAME-STAGE GUARD (Section 20/50/59): Proposal → Proposal is a no-op —
  // stageEnteredAt is NOT reset (managers must not be able to refresh a
  // stale timer), no duplicate STAGE_CHANGE activity, no events.
  if (lead.stageId === stage.id) {
    return db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
  }

  const prevStageId = lead.stageId;
  // ONE atomic update: stage + status + stageEnteredAt together (Section 82 —
  // the lead can never end up with a changed stage but a stale timer).
  const updated = await db.lead.update({
    where: { id: leadId },
    data: {
      stageId: stage.id,
      pipelineId: stage.pipelineId,
      status:
        stage.type === STAGE_TYPE.WON
          ? LEAD_STATUS.WON
          : stage.type === STAGE_TYPE.LOST
          ? LEAD_STATUS.LOST
          : stage.name === "New"
          ? LEAD_STATUS.NEW
          : stage.name === "Contacted"
          ? LEAD_STATUS.CONTACTED
          : stage.name === "Qualified"
          ? LEAD_STATUS.QUALIFIED
          : LEAD_STATUS.OPEN,
      // STAGE INACTIVITY: a REAL transition restarts the stage timer.
      stageEnteredAt: new Date(),
    },
  });

  // suggest next action when moving to an open stage
  if (stage.type === STAGE_TYPE.OPEN) {
    const s = suggestNextAction(stage.name);
    await db.lead.update({
      where: { id: leadId },
      data: { nextActionAt: s.nextActionAt, nextActionLabel: s.label, lastContactAt: new Date() },
    });
  } else {
    // FINAL STAGE POLICY (Won/Lost): cancel open follow-up tasks — rows kept
    // for history; the engine also defensively ignores leftovers, so a Won/
    // Lost lead can NEVER show a false overdue follow-up.
    await cancelFollowUpsForFinalStage(orgId, leadId, userId);
    await db.lead.update({
      where: { id: leadId },
      data: { nextActionAt: null, nextActionLabel: null, lastContactAt: new Date() },
    });
  }

  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId,
      userId,
      type: ACTIVITY_TYPE.STAGE_CHANGE,
      title: `Stage changed to ${stage.name}`,
      metadata: { from: prevStageId, to: stage.id, stageName: stage.name } as Prisma.InputJsonValue,
    },
  });

  let eventType: typeof LEAD_EVENT[keyof typeof LEAD_EVENT] = LEAD_EVENT.STAGE_CHANGED;
  if (stage.type === STAGE_TYPE.WON) eventType = LEAD_EVENT.LEAD_WON;
  else if (stage.type === STAGE_TYPE.LOST) eventType = LEAD_EVENT.LEAD_LOST;
  else if (stage.name === "Qualified") eventType = LEAD_EVENT.LEAD_QUALIFIED;
  await publishEvent({
    orgId,
    leadId,
    userId,
    type: eventType,
    payload: { fromStageId: prevStageId, toStageId: stage.id, stageName: stage.name } as Prisma.InputJsonValue,
  });

  // EVENT ENGINE (Sections 40/65): a REAL stage transition (or entering a
  // final stage) resolves every active stage problem notification for this
  // lead — the deal moved, the stale/aging alert is no longer actual.
  await resolveStageNotifications(orgId, leadId);

  return db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
}

export async function assignLead(
  orgId: string,
  leadId: string,
  userId: string | null,
  ownerId: string
) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.organizationId !== orgId) throw new Error("LEAD_NOT_FOUND");
  const owner = await db.user.findUnique({ where: { id: ownerId } });
  if (!owner || owner.organizationId !== orgId) throw new Error("USER_NOT_FOUND");
  const updated = await db.lead.update({
    where: { id: leadId },
    data: { ownerId },
  });
  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId,
      userId,
      type: ACTIVITY_TYPE.ASSIGNMENT,
      title: `Assigned to ${owner.name}`,
      metadata: { ownerId } as Prisma.InputJsonValue,
    },
  });
  await publishEvent({
    orgId,
    leadId,
    userId,
    type: LEAD_EVENT.LEAD_ASSIGNED,
    payload: { ownerId, ownerName: owner.name } as Prisma.InputJsonValue,
  });
  // EVENT ENGINE: real owner change → LEAD_ASSIGNED (recipient = new owner).
  // Re-assigning the SAME owner emits nothing (Section 98).
  if (lead.ownerId !== ownerId) {
    await emitLeadAssigned(orgId, updated, userId);
  }
  return updated;
}

export async function archiveLead(orgId: string, leadId: string, userId: string | null) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.organizationId !== orgId) throw new Error("LEAD_NOT_FOUND");
  const updated = await db.lead.update({
    where: { id: leadId },
    data: { status: LEAD_STATUS.ARCHIVED, archivedAt: new Date() },
  });
  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId,
      userId,
      type: ACTIVITY_TYPE.SYSTEM_EVENT,
      title: "Lead archived",
    },
  });
  await publishEvent({
    orgId,
    leadId,
    userId,
    type: LEAD_EVENT.LEAD_ARCHIVED,
    payload: {} as Prisma.InputJsonValue,
  });
  // EVENT ENGINE: an archived lead is not monitored by any engine — every
  // active problem notification for it resolves (history is kept).
  await resolveAllLeadProblems(orgId, leadId);
  return updated;
}

export async function restoreLead(orgId: string, leadId: string, userId: string | null) {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { stage: true } });
  if (!lead || lead.organizationId !== orgId) throw new Error("LEAD_NOT_FOUND");
  const status =
    lead.stage?.type === "won" ? LEAD_STATUS.WON :
    lead.stage?.type === "lost" ? LEAD_STATUS.LOST :
    lead.stage?.name === "New" ? LEAD_STATUS.NEW :
    lead.stage?.name === "Contacted" ? LEAD_STATUS.CONTACTED :
    lead.stage?.name === "Qualified" ? LEAD_STATUS.QUALIFIED :
    LEAD_STATUS.OPEN;
  const updated = await db.lead.update({
    where: { id: leadId },
    data: { status, archivedAt: null },
  });
  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId,
      userId,
      type: ACTIVITY_TYPE.SYSTEM_EVENT,
      title: "Lead restored from archive",
    },
  });
  return updated;
}

export async function mergeLeads(
  orgId: string,
  targetId: string,
  sourceId: string,
  userId: string | null
) {
  if (targetId === sourceId) throw new Error("SAME_LEAD");
  const target = await db.lead.findUnique({ where: { id: targetId } });
  const source = await db.lead.findUnique({ where: { id: sourceId } });
  if (!target || target.organizationId !== orgId) throw new Error("TARGET_NOT_FOUND");
  if (!source || source.organizationId !== orgId) throw new Error("SOURCE_NOT_FOUND");

  // move child records from source → target
  await db.activity.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  await db.task.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  await db.note.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  await db.leadEvent.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  await db.leadScoreComponent.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  await db.lostLeadFlag.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  await db.sourceAttribution.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  await db.incomingMessage.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  await db.integrationSync.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  // lead tags — dedupe
  const sourceTags = await db.leadTag.findMany({ where: { leadId: sourceId } });
  for (const st of sourceTags) {
    const existing = await db.leadTag.findUnique({ where: { leadId_tagId: { leadId: targetId, tagId: st.tagId } } });
    if (!existing) await db.leadTag.create({ data: { leadId: targetId, tagId: st.tagId } }).catch(() => {});
  }
  await db.leadTag.deleteMany({ where: { leadId: sourceId } });
  // audit — reassign if target has none
  const targetAudit = await db.businessAudit.findFirst({ where: { leadId: targetId } });
  if (!targetAudit) await db.businessAudit.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
  else await db.businessAudit.updateMany({ where: { leadId: sourceId }, data: { leadId: null } });

  // archive source
  await db.lead.update({
    where: { id: sourceId },
    data: { status: LEAD_STATUS.ARCHIVED, archivedAt: new Date(), externalId: `merged:${targetId}` },
  });
  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId: targetId,
      userId,
      type: ACTIVITY_TYPE.SYSTEM_EVENT,
      title: "Lead merged",
      description: `Merged duplicate into this lead`,
      metadata: { sourceId } as Prisma.InputJsonValue,
    },
  });
  await publishEvent({
    orgId,
    leadId: targetId,
    userId,
    type: LEAD_EVENT.LEAD_MERGED,
    payload: { sourceId } as Prisma.InputJsonValue,
  });
  return db.lead.findUniqueOrThrow({ where: { id: targetId } });
}

/** Compute last activity timestamp for a lead (used by lost detector). */
export async function lastActivityAt(orgId: string, leadId: string): Promise<Date | null> {
  const last = await db.activity.findFirst({
    where: { leadId, organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last?.createdAt ?? null;
}

/**
 * Resolve an assignee for a new lead using the org's assignment rules.
 * Rules are evaluated in position order; first match wins.
 * If no rule matches, returns null (lead stays unassigned).
 * This is deterministic routing — NOT AI.
 */
export async function resolveAutoAssignee(
  orgId: string,
  ctx: { sourceId?: string | null; sourceType?: string | null; priority?: string }
): Promise<string | null> {
  const rules = await db.assignmentRule.findMany({
    where: { organizationId: orgId, enabled: true },
    orderBy: { position: "asc" },
  });
  for (const r of rules) {
    let match = true;
    if (r.sourceId && r.sourceId !== ctx.sourceId) match = false;
    if (r.sourceType && r.sourceType !== ctx.sourceType) match = false;
    if (r.priority && r.priority !== ctx.priority) match = false;
    if (match) {
      // verify assignee still active in org
      const a = await db.user.findUnique({ where: { id: r.assigneeId }, select: { organizationId: true, status: true } });
      if (a && a.organizationId === orgId && a.status === "ACTIVE") return r.assigneeId;
    }
  }
  return null;
}

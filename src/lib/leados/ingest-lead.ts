/**
 * Canonical Lead Ingestion Service
 * 
 * Single entry point for ingesting leads from external sources:
 * - Meta Lead Ads
 * - Website forms
 * - API integrations
 * - CSV imports
 * 
 * This service ensures consistent handling, duplicate detection,
 * attribution, and event emission across all ingestion channels.
 * 
 * CRITICAL RULE (Spec #1): External connectors NEVER create Lead
 * records directly via Prisma. They MUST call ingestLead().
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  ACTIVITY_TYPE,
  LEAD_EVENT,
  LEAD_STATUS,
  PRIORITY,
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

/**
 * Source type enum for ingestion.
 * Matches LeadSource.type values.
 */
export type IngestSourceType =
  | "meta"
  | "website"
  | "api"
  | "csv"
  | "business_audit"
  | "instagram"
  | "facebook"
  | "whatsapp"
  | "telegram"
  | "google_ads"
  | "meta_ads"
  | "referral"
  | "manual"
  | "email"
  | "phone"
  | "other";

/**
 * Canonical ingestion input.
 * All external sources map their data to this format.
 */
export interface IngestLeadInput {
  /** Organization ID (tenant isolation) */
  organizationId: string;

  /** Source type (meta, website, api, etc.) */
  sourceType: IngestSourceType;

  /** External source identifier (e.g., Meta leadgen_id) for idempotency */
  externalId?: string;

  /** Human-readable source detail (form name, landing page, etc.) */
  sourceDetail?: string;

  /** Lead data */
  firstName?: string;
  lastName?: string;
  fullName?: string; // Will be split if firstName/lastName not provided
  company?: string;
  position?: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;

  /** Optional fields */
  locale?: string;
  preferredChannel?: string;
  summary?: string;
  requirements?: string;
  estimatedValue?: number;
  currency?: string;
  priority?: typeof PRIORITY[keyof typeof PRIORITY];

  /** Assignment */
  defaultOwnerId?: string;
  defaultStageId?: string;

  /** UTM attribution */
  utm?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    landingPage?: string;
    referrer?: string;
  };

  /** Meta-specific metadata (stored in sourceDetail JSON) */
  metaMetadata?: {
    pageId?: string;
    formId?: string;
    campaignId?: string;
    adId?: string;
    adsetId?: string;
    metaCreatedAt?: Date;
    webhookReceivedAt?: Date;
    leadFetchedAt?: Date;
  };

  /** Custom fields (for future extensibility) */
  customFields?: Record<string, string>;

  /** Tags to apply */
  tags?: string[];

  /** Initial note */
  note?: string;

  /** Force creation even if duplicate exists */
  force?: boolean;

  /** Actor user ID (for audit trail, null for system/auto-ingestion) */
  actorUserId?: string | null;
}

export interface IngestLeadResult {
  lead: Awaited<ReturnType<typeof db.lead.findUniqueOrThrow>>;
  duplicate?: DuplicateCheckResult;
  created: boolean;
  ingestionId: string;
}

/**
 * Auto-assignment resolution based on assignment rules.
 */
async function resolveAutoAssignee(
  orgId: string,
  context: {
    sourceId?: string | null;
    sourceType?: string | null;
    priority?: string;
  }
): Promise<string | null> {
  const rules = await db.assignmentRule.findMany({
    where: { organizationId: orgId, enabled: true },
    orderBy: { position: "asc" },
  });

  for (const rule of rules) {
    let matches = true;

    if (rule.sourceId && context.sourceId !== rule.sourceId) {
      matches = false;
    }

    if (rule.sourceType && context.sourceType !== rule.sourceType) {
      matches = false;
    }

    if (rule.priority && context.priority !== rule.priority) {
      matches = false;
    }

    if (matches) {
      return rule.assigneeId;
    }
  }

  return null;
}

/**
 * Recompute lead score based on scoring config.
 */
async function recomputeScore(
  orgId: string,
  lead: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    phone?: string | null;
    email?: string | null;
    priority: string;
    estimatedValue?: number | null;
    sourceId?: string | null;
    stageId?: string | null;
    ownerId?: string | null;
  },
  stageName?: string | null
): Promise<void> {
  const rules = await db.scoringConfig.findMany({
    where: { organizationId: orgId },
  });
  const source = lead.sourceId
    ? await db.leadSource.findUnique({ where: { id: lead.sourceId } })
    : null;

  const result = computeScore(
    {
      audit: null,
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
    rules.map((r) => ({
      key: r.key,
      label: r.label,
      points: r.points,
      enabled: r.enabled,
    }))
  );

  await db.leadScoreComponent.deleteMany({ where: { leadId: lead.id } });
  await db.lead.update({
    where: { id: lead.id },
    data: {
      leadScore: result.score,
      scoreCategory: result.category,
    },
  });

  for (const c of result.components) {
    await db.leadScoreComponent.create({
      data: { leadId: lead.id, reason: c.reason, key: c.key, delta: c.delta },
    });
  }
}

/**
 * Emit a LEAD_ASSIGNED domain event.
 */
async function emitLeadAssigned(
  orgId: string,
  lead: {
    id: string;
    createdAt: Date;
    ownerId: string | null;
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
  },
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

/**
 * CANONICAL LEAD INGESTION
 * 
 * This is the ONLY entry point for external lead ingestion.
 * All connectors (Meta, Website, API, CSV) MUST use this function.
 * 
 * Features:
 * - Duplicate detection (phone/email/externalId)
 * - Auto-assignment based on rules
 * - Source attribution
 * - Scoring
 * - Event emission (LEAD_INGESTED for automation triggers)
 * - Activity logging
 * 
 * Idempotency:
 * - Same externalId returns existing lead (no duplicate)
 * - Same phone/email triggers duplicate detection
 */
export async function ingestLead(
  input: IngestLeadInput
): Promise<IngestLeadResult> {
  const {
    organizationId,
    sourceType,
    externalId,
    sourceDetail,
    firstName: inputFirstName,
    lastName: inputLastName,
    fullName,
    company,
    position,
    phone,
    email,
    city,
    country,
    locale,
    preferredChannel,
    summary,
    requirements,
    estimatedValue,
    currency,
    priority = PRIORITY.MEDIUM,
    defaultOwnerId,
    defaultStageId,
    utm,
    metaMetadata,
    customFields,
    tags,
    note,
    force = false,
    actorUserId = null,
  } = input;

  // Normalize contact info
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const normalizedEmail = email ? normalizeEmail(email) : null;

  // Handle fullName splitting
  let firstName = inputFirstName;
  let lastName = inputLastName;
  if (!firstName && !lastName && fullName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts.slice(1).join(" ");
    } else {
      firstName = fullName;
    }
  }

  // Duplicate check (unless forced)
  let duplicate: DuplicateCheckResult | undefined;
  if (!force) {
    duplicate = await detectDuplicates(organizationId, {
      phone: normalizedPhone ?? undefined,
      email: normalizedEmail ?? undefined,
      externalId: externalId ?? undefined,
    });

    if (duplicate.hasDuplicates) {
      // Return existing lead without creating duplicate
      const existingLeadId = duplicate.existingLeads[0]?.id;
      if (existingLeadId) {
        const existingLead = await db.lead.findUniqueOrThrow({
          where: { id: existingLeadId },
          include: { stage: true, source: true, owner: true },
        });

        return {
          lead: existingLead,
          duplicate,
          created: false,
          ingestionId: `existing-${existingLeadId}`,
        };
      }
    }
  }

  // Resolve source
  let sourceId: string | null = null;
  const source = await db.leadSource.findFirst({
    where: { organizationId, type: sourceType },
  });

  if (source) {
    sourceId = source.id;
  } else {
    // Create source if it doesn't exist
    const createdSource = await db.leadSource.create({
      data: {
        organizationId,
        name: sourceType.toUpperCase(),
        type: sourceType,
        isSystem: true,
      },
    });
    sourceId = createdSource.id;
  }

  // Build source detail with metadata
  let finalSourceDetail = sourceDetail;
  if (metaMetadata && Object.keys(metaMetadata).length > 0) {
    finalSourceDetail = JSON.stringify({
      ...(sourceDetail ? { manual: sourceDetail } : {}),
      ...metaMetadata,
    });
  }

  // Resolve stage/pipeline
  let stageId = defaultStageId ?? null;
  let pipelineId: string | null = null;

  if (!stageId) {
    const pipeline = await db.pipeline.findFirst({
      where: { organizationId, isDefault: true },
    });
    if (pipeline) {
      pipelineId = pipeline.id;
      const firstStage = await db.pipelineStage.findFirst({
        where: { pipelineId: pipeline.id },
        orderBy: { position: "asc" },
      });
      stageId = firstStage?.id ?? null;
    }
  } else {
    const stage = await db.pipelineStage.findUnique({
      where: { id: stageId },
      include: { pipeline: true },
    });
    if (stage?.pipeline) {
      pipelineId = pipeline.id;
    }
  }

  const stage = stageId
    ? await db.pipelineStage.findUnique({ where: { id: stageId } })
    : null;

  const now = new Date();
  const nextActionSuggestion = stage
    ? suggestNextAction(stage.name, now)
    : { nextActionAt: null, label: null };

  const nextActionAt = nextActionSuggestion.nextActionAt;
  const nextActionLabel = nextActionSuggestion.label;

  // Auto-assignment: explicit owner > rules > null
  let ownerId = defaultOwnerId ?? null;
  if (!ownerId) {
    ownerId = await resolveAutoAssignee(organizationId, {
      sourceId,
      sourceType,
      priority,
    });
  }

  // Create the lead
  const lead = await db.lead.create({
    data: {
      organizationId,
      externalId: externalId ?? null,
      sourceId,
      sourceDetail: finalSourceDetail ?? null,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      company: company ?? null,
      position: position ?? null,
      phone: phone ?? null,
      normalizedPhone: normalizedPhone,
      email: email ?? null,
      normalizedEmail: normalizedEmail,
      preferredChannel: preferredChannel ?? null,
      locale: locale ?? null,
      status: LEAD_STATUS.NEW,
      pipelineId: pipelineId,
      stageId: stageId,
      ownerId: ownerId,
      priority: priority,
      estimatedValue: estimatedValue ?? null,
      currency: currency ?? null,
      summary: summary ?? null,
      requirements: requirements ?? null,
      nextActionAt,
      nextActionLabel: nextActionLabel ?? null,
      stageEnteredAt: now, // Stage inactivity tracking starts now
    },
  });

  // Apply tags
  if (tags && tags.length > 0) {
    const existingTags = await db.tag.findMany({
      where: { organizationId, name: { in: tags } },
    });
    const existingNames = new Set(existingTags.map((t) => t.name));
    const toCreate = tags.filter((t) => !existingNames.has(t));

    const createdTags = await Promise.all(
      toCreate.map((name) =>
        db.tag
          .create({
            data: { organizationId, name, color: "#64748b" },
          })
          .catch(() => null)
      )
    );

    const allTags = [...existingTags, ...createdTags.filter(Boolean)] as Array<{
      id: string;
    }>;

    for (const tag of allTags) {
      await db.leadTag.create({
        data: { leadId: lead.id, tagId: tag.id },
      }).catch(() => {});
    }
  }

  // Record attribution
  if (utm) {
    await recordAttribution(lead.id, sourceType, utm);
  }

  // Add initial note
  if (note) {
    await db.note.create({
      data: {
        organizationId,
        leadId: lead.id,
        userId: actorUserId,
        content: note,
      },
    });
  }

  // Recompute score
  await recomputeScore(organizationId, lead, stage?.name ?? null);

  // Create activity log
  await db.activity.create({
    data: {
      organizationId,
      leadId: lead.id,
      userId: actorUserId,
      type: ACTIVITY_TYPE.SYSTEM_EVENT,
      title: "Lead ingested",
      description: `Ingested via ${sourceType}${externalId ? ` (external ID: ${externalId})` : ""}`,
    },
  });

  // Publish events
  await publishEvent({
    orgId: organizationId,
    leadId: lead.id,
    userId: actorUserId,
    type: LEAD_EVENT.LEAD_CREATED,
    payload: {
      source: sourceType,
      externalId: externalId ?? null,
      stage: stage?.name ?? null,
    } as Prisma.InputJsonValue,
  });

  if (ownerId) {
    await publishEvent({
      orgId: organizationId,
      leadId: lead.id,
      userId: actorUserId,
      type: LEAD_EVENT.LEAD_ASSIGNED,
      payload: { ownerId } as Prisma.InputJsonValue,
    });
  }

  // Emit domain event for assignment notification
  if (lead.ownerId) {
    await emitLeadAssigned(organizationId, lead, actorUserId);
  }

  // CRITICAL: Emit LEAD_INGESTED event for Automation Engine
  // This triggers automations like "WHEN LEAD_INGESTED IF sourceType=META THEN..."
  await publishDomainEvent(organizationId, {
    type: DOMAIN_EVENT.LEAD_INGESTED,
    entityType: ENTITY_TYPE.LEAD,
    entityId: lead.id,
    actorUserId: actorUserId,
    occurredAt: now,
    deduplicationKey: `LEAD_INGESTED:${lead.id}:${now.toISOString()}`,
    payload: {
      leadId: lead.id,
      leadName: displayName(lead),
      sourceType,
      sourceId: sourceId ?? undefined,
      externalId: externalId ?? undefined,
      ownerId: ownerId ?? undefined,
    },
  });

  // Fetch full lead with relations
  const fullLead = await db.lead.findUniqueOrThrow({
    where: { id: lead.id },
    include: {
      stage: true,
      source: true,
      owner: true,
    },
  });

  return {
    lead: fullLead,
    duplicate,
    created: true,
    ingestionId: lead.id,
  };
}

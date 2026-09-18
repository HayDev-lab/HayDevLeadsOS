// Business Audit ingestion — accepts a completed audit payload and creates
// (or updates) a lead with the audit data attached, then recomputes the score.
// This is the integration point between the existing Business Audit product
// and LeadOS. The audit UI itself lives in the Business Audit module; LeadOS
// only stores the summary + links it to the lead.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ACTIVITY_TYPE, LEAD_EVENT, LEAD_STATUS, PRIORITY } from "./constants";
import { normalizeEmail, normalizeName, normalizePhone } from "./normalize";
import { computeScore } from "./scoring";
import { publishEvent } from "./events";

export const BusinessAuditPayload = z.object({
  externalId: z.string().optional(),
  companyName: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  locale: z.string().optional(),
  scores: z
    .object({
      acquisition: z.number().min(0).max(100).optional(),
      sales: z.number().min(0).max(100).optional(),
      operations: z.number().min(0).max(100).optional(),
      data: z.number().min(0).max(100).optional(),
      automation: z.number().min(0).max(100).optional(),
      aiReadiness: z.number().min(0).max(100).optional(),
    })
    .optional(),
  automationMap: z.any().optional(),
  priorityAutomations: z.any().optional(),
  recommendations: z.any().optional(),
  reportSummary: z.string().optional(),
  utm: z
    .object({
      utm_source: z.string().optional(),
      utm_medium: z.string().optional(),
      utm_campaign: z.string().optional(),
      utm_content: z.string().optional(),
      landing_page: z.string().optional(),
      referrer: z.string().optional(),
    })
    .optional(),
  meta: z.any().optional(),
});
export type BusinessAuditPayloadT = z.infer<typeof BusinessAuditPayload>;

export interface IngestAuditResult {
  leadId: string;
  auditId: string;
  created: boolean;
}

/**
 * Ingest a Business Audit completion. Creates or updates the matching lead,
 * attaches the audit, recomputes score, and publishes audit.completed.
 */
export async function ingestBusinessAudit(
  orgId: string,
  payload: BusinessAuditPayloadT,
  userId?: string | null
): Promise<IngestAuditResult> {
  const normalizedEmail = normalizeEmail(payload.contactEmail);
  const normalizedPhone = normalizePhone(payload.contactPhone);
  const source = await db.leadSource.findFirst({
    where: { organizationId: orgId, type: "business_audit" },
  });

  // try to find an existing lead by normalized phone/email
  let lead: Awaited<ReturnType<typeof db.lead.findFirst>> | Awaited<ReturnType<typeof db.lead.create>> | null = null;
  if (normalizedPhone || normalizedEmail) {
    lead = await db.lead.findFirst({
      where: {
        organizationId: orgId,
        OR: [
          ...(normalizedPhone ? [{ normalizedPhone }] : []),
          ...(normalizedEmail ? [{ normalizedEmail }] : []),
        ],
      },
    });
  }

  const first = payload.contactName ? normalizeName(payload.contactName.split(" ")[0]) : null;
  const last = payload.contactName ? normalizeName(payload.contactName.split(" ").slice(1).join(" ")) : null;

  const created = !lead;
  if (!lead) {
    lead = await db.lead.create({
      data: {
        organizationId: orgId,
        sourceId: source?.id ?? null,
        sourceDetail: "Business Audit",
        firstName: first,
        lastName: last,
        company: payload.companyName ?? null,
        phone: payload.contactPhone ?? null,
        normalizedPhone,
        email: payload.contactEmail ?? null,
        normalizedEmail,
        locale: payload.locale ?? null,
        status: LEAD_STATUS.NEW,
        priority: PRIORITY.MEDIUM,
        summary: `Business Audit completed`,
        externalId: payload.externalId ?? null,
      },
    });
  } else {
    // update existing lead with audit info if missing
    const patch: Record<string, unknown> = {};
    if (!lead.company && payload.companyName) patch.company = payload.companyName;
    if (!lead.email && payload.contactEmail) {
      patch.email = payload.contactEmail;
      patch.normalizedEmail = normalizedEmail;
    }
    if (!lead.phone && payload.contactPhone) {
      patch.phone = payload.contactPhone;
      patch.normalizedPhone = normalizedPhone;
    }
    if (!lead.firstName && first) patch.firstName = first;
    if (!lead.lastName && last) patch.lastName = last;
    if (Object.keys(patch).length) {
      lead = await db.lead.update({ where: { id: lead.id }, data: patch });
    }
  }

  const scores = payload.scores ?? {};
  const audit = await db.businessAudit.create({
    data: {
      organizationId: orgId,
      leadId: lead.id,
      externalId: payload.externalId ?? null,
      companyName: payload.companyName ?? null,
      contactName: payload.contactName ?? null,
      contactEmail: payload.contactEmail ?? null,
      contactPhone: payload.contactPhone ?? null,
      locale: payload.locale ?? null,
      acquisition: scores.acquisition ?? 0,
      sales: scores.sales ?? 0,
      operations: scores.operations ?? 0,
      data: scores.data ?? 0,
      automation: scores.automation ?? 0,
      aiReadiness: scores.aiReadiness ?? 0,
      automationMap: (payload.automationMap ?? null) as Prisma.InputJsonValue,
      priorityAutomations: (payload.priorityAutomations ?? null) as Prisma.InputJsonValue,
      recommendations: (payload.recommendations ?? null) as Prisma.InputJsonValue,
      reportSummary: payload.reportSummary ?? null,
      payload: (payload.meta ?? payload) as Prisma.InputJsonValue,
    },
  });

  // attribution
  if (payload.utm) {
    await db.sourceAttribution.create({
      data: {
        leadId: lead.id,
        source: "business_audit",
        campaign: payload.utm.utm_campaign ?? null,
        utmSource: payload.utm.utm_source ?? null,
        utmMedium: payload.utm.utm_medium ?? null,
        utmContent: payload.utm.utm_content ?? null,
        landingPage: payload.utm.landing_page ?? null,
        referrer: payload.utm.referrer ?? null,
      },
    });
  }

  // recompute score
  const rules = await db.scoringConfig.findMany({ where: { organizationId: orgId } });
  const result = computeScore(
    {
      audit: { automation: scores.automation ?? 0, aiReadiness: scores.aiReadiness ?? 0 },
      estimatedValue: null,
      priority: lead.priority ?? PRIORITY.MEDIUM,
      stageName: null,
      firstName: lead.firstName,
      lastName: lead.lastName,
      company: lead.company,
      phone: lead.phone,
      email: lead.email,
      sourceType: "business_audit",
    },
    rules.map((r) => ({ key: r.key, label: r.label, points: r.points, enabled: r.enabled }))
  );
  await db.leadScoreComponent.deleteMany({ where: { leadId: lead.id, key: { startsWith: "audit_" } } });
  await db.lead.update({
    where: { id: lead.id },
    data: { leadScore: result.score, scoreCategory: result.category },
  });
  for (const c of result.components) {
    await db.leadScoreComponent.create({
      data: { leadId: lead.id, reason: c.reason, key: c.key, delta: c.delta },
    });
  }

  // activity + events
  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId: lead.id,
      userId: userId ?? null,
      type: ACTIVITY_TYPE.AUDIT_IMPORT,
      title: "Business Audit completed",
      description: payload.reportSummary ?? `Acquisition ${scores.acquisition ?? 0} · Automation ${scores.automation ?? 0}`,
      metadata: { auditId: audit.id } as Prisma.InputJsonValue,
    },
  });
  await publishEvent({
    orgId,
    leadId: lead.id,
    userId,
    type: LEAD_EVENT.AUDIT_COMPLETED,
    payload: { auditId: audit.id, scores } as Prisma.InputJsonValue,
  });
  if (created) {
    await publishEvent({
      orgId,
      leadId: lead.id,
      userId,
      type: LEAD_EVENT.LEAD_CREATED,
      payload: { via: "business_audit" } as Prisma.InputJsonValue,
    });
  }

  return { leadId: lead.id, auditId: audit.id, created };
}

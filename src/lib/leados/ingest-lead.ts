// HAYDEV LEADOS — CANONICAL EXTERNAL INGESTION (v0.19).
//
// ONE entry point for every external channel that creates leads:
//   Meta Lead Ads → connector → ingestLead() → createLead() → Lead
//   Business Audit (legacy direct path) — migrates to this wrapper over time.
//
// The wrapper adds what channel ingestion needs ON TOP of createLead():
//   • external-id idempotency: a channel retrying the same externalId NEVER
//     creates a second Lead — the existing lead is returned (created: false);
//   • LEAD_INGESTED domain event (durable, deduplicated by channel+externalId)
//     — downstream SLA / Automation / Notification react exactly once;
//   • attribution note with the channel + form context.
//
// INVARIANT (v0.19 spec 15): NO integration may call db.lead.create() directly.
// Everything flows through createLead via this wrapper.

import { db } from "@/lib/db";
import { createLead, type CreateLeadInput, type CreateLeadResult } from "./lead-service";
import { publishDomainEvent } from "./domain-event-service";
import { DOMAIN_EVENT, ENTITY_TYPE } from "@/lib/domain-events";

export interface IngestLeadInput extends CreateLeadInput {
  /** Channel slug, e.g. "meta_lead_ads" — used for the LEAD_INGESTED dedup key. */
  channel: string;
  /** Stable external id (Meta: leadgenId). Idempotency key for the channel. */
  externalId: string;
  /** Channel display context for the attribution note (e.g. "Meta Lead Ads · Website Development Leads"). */
  channelContext?: string;
}

export interface IngestLeadResult {
  lead: CreateLeadResult["lead"];
  created: boolean;
  /** True when an existing lead with this externalId was found and reused. */
  deduplicated: boolean;
  duplicateCheck: CreateLeadResult["duplicate"];
}

export async function ingestLead(
  orgId: string,
  userId: string | null,
  input: IngestLeadInput
): Promise<IngestLeadResult> {
  // Idempotency pre-check: an earlier call may have crashed AFTER createLead
  // but BEFORE the caller recorded completion — same externalId must resolve
  // to the SAME lead, never a duplicate.
  const existing = await db.lead.findFirst({
    where: { organizationId: orgId, externalId: input.externalId },
    include: { stage: true, source: true, owner: true },
  });
  if (existing) {
    return { lead: existing, created: false, deduplicated: true, duplicateCheck: undefined };
  }

  const note = input.note
    ? `${input.channelContext ? `${input.channelContext}\n` : ""}${input.note}`
    : input.channelContext ?? null;

  const result = await createLead(orgId, userId, { ...input, note: note ?? undefined });

  if (!result.created) {
    // createLead found a duplicate by phone/email. For channel ingestion the
    // POLICY is: return the duplicate info WITHOUT creating — the channel
    // adapter (Meta) accepts the event; the canonical duplicate engine owns
    // the decision. Resolve the matched lead when it carries the same externalId.
    const match = result.duplicate?.matches?.[0];
    const existingByExternal = match?.id
      ? await db.lead.findUnique({ where: { id: match.id }, include: { stage: true, source: true, owner: true } })
      : null;
    if (existingByExternal && existingByExternal.externalId === input.externalId) {
      return { lead: existingByExternal, created: false, deduplicated: true, duplicateCheck: result.duplicate };
    }
    return {
      lead: existingByExternal ?? (null as unknown as CreateLeadResult["lead"]),
      created: false,
      deduplicated: false,
      duplicateCheck: result.duplicate,
    };
  }

  // Exactly-once LEAD_INGESTED domain event (durable, race-safe via the
  // (organizationId, deduplicationKey) unique constraint).
  await publishDomainEvent(orgId, {
    type: DOMAIN_EVENT.LEAD_INGESTED,
    entityType: ENTITY_TYPE.LEAD,
    entityId: result.lead.id,
    actorUserId: userId,
    occurredAt: new Date(),
    deduplicationKey: `LEAD_INGESTED:${input.channel}:${input.externalId}`,
    payload: {
      leadId: result.lead.id,
      channel: input.channel,
      externalId: input.externalId,
      context: input.channelContext ?? null,
      ownerId: result.lead.ownerId ?? null,
    },
  });

  return { lead: result.lead, created: true, deduplicated: false, duplicateCheck: undefined };
}

// Event publishing architecture — writes both immutable LeadEvent (audit trail)
// and IntegrationEvent (for future Automation Engine / Owner AI subscribers).

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { INTEGRATION_EVENTS, LEAD_EVENT, type LeadEventType } from "./constants";

export interface PublishEventInput {
  orgId: string;
  leadId?: string | null;
  userId?: string | null;
  type: LeadEventType;
  payload?: Prisma.InputJsonValue | null;
}

/** Map an internal LeadEventType to the public integration event name. */
function publicEvent(type: LeadEventType): string | null {
  switch (type) {
    case LEAD_EVENT.LEAD_CREATED: return INTEGRATION_EVENTS.LEAD_CREATED;
    case LEAD_EVENT.LEAD_ASSIGNED: return INTEGRATION_EVENTS.LEAD_ASSIGNED;
    case LEAD_EVENT.STAGE_CHANGED: return INTEGRATION_EVENTS.LEAD_STAGE_CHANGED;
    case LEAD_EVENT.LEAD_QUALIFIED: return INTEGRATION_EVENTS.LEAD_QUALIFIED;
    case LEAD_EVENT.LEAD_WON: return INTEGRATION_EVENTS.LEAD_WON;
    case LEAD_EVENT.LEAD_LOST: return INTEGRATION_EVENTS.LEAD_LOST;
    case LEAD_EVENT.TASK_CREATED: return INTEGRATION_EVENTS.TASK_CREATED;
    case LEAD_EVENT.TASK_OVERDUE: return INTEGRATION_EVENTS.TASK_OVERDUE;
    case LEAD_EVENT.AUDIT_COMPLETED: return INTEGRATION_EVENTS.AUDIT_COMPLETED;
    default: return null;
  }
}

/**
 * Publish a lead event. Writes:
 *  - a LeadEvent (immutable audit row, always)
 *  - an IntegrationEvent (for subscribers), if a public mapping exists
 *
 * Returns the created LeadEvent id.
 */
export async function publishEvent(input: PublishEventInput): Promise<string> {
  const ev = await db.leadEvent.create({
    data: {
      organizationId: input.orgId,
      leadId: input.leadId ?? undefined,
      userId: input.userId ?? undefined,
      type: input.type as string,
      payload: (input.payload ?? null) as Prisma.InputJsonValue,
    } as Prisma.LeadEventUncheckedCreateInput,
  });
  const pub = publicEvent(input.type);
  if (pub) {
    await db.integrationEvent.create({
      data: {
        organizationId: input.orgId,
        leadId: input.leadId ?? undefined,
        event: pub,
        payload: (input.payload ?? null) as Prisma.InputJsonValue,
        published: true,
        publishedAt: new Date(),
      } as Prisma.IntegrationEventUncheckedCreateInput,
    });
  }
  return ev.id;
}

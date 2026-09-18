// HAYDEV LEADOS — server-side DOMAIN EVENT service (v0.14).
//
// Architectural chain (spec header):
//   BUSINESS STATE → STATE TRANSITION → DOMAIN EVENT → EVENT STORE
//   → NOTIFICATION PROJECTOR → IN-APP NOTIFICATION → READ/RESOLVED.
//
// Guarantees:
//  - events are DURABLE rows, never an in-memory emitter (Section 93);
//  - one transition = one event (deterministic dedup key + DB unique);
//  - the projector is idempotent (unique(eventId, userId)) and re-runnable
//    for unprocessed events (processedAt recovery, Sections 88–92);
//  - notifications are created ONLY here — never from React components
//    (Section 1: business transition → domain event → notification engine).

import { db } from "@/lib/db";
import { Prisma, type DomainEvent, type Notification } from "@prisma/client";
import {
  DOMAIN_EVENT,
  ENTITY_TYPE,
  EVENT_SEVERITY,
  NOTIFICATION_TEMPLATES,
  leadDeepLink,
  renderEnglishSnapshot,
  taskDeepLink,
  type DomainEventType,
  type PlannedEvent,
  type Severity,
} from "@/lib/domain-events";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "@/lib/domain-events";
import { getAutomationExecutionContext } from "./automation-context";

// ---------------------------------------------------------------------------
// Deep link resolution per event type
// ---------------------------------------------------------------------------

function deepLinkFor(type: DomainEventType, payload: Record<string, unknown>): string | null {
  switch (type) {
    case DOMAIN_EVENT.FIRST_RESPONSE_BREACHED:
      return payload.leadId ? leadDeepLink(String(payload.leadId), "activity") : null;
    case DOMAIN_EVENT.FOLLOW_UP_DUE_SOON:
    case DOMAIN_EVENT.FOLLOW_UP_OVERDUE:
      return payload.leadId ? leadDeepLink(String(payload.leadId), "followup") : taskDeepLink(String(payload.taskId));
    case DOMAIN_EVENT.STAGE_AGING:
    case DOMAIN_EVENT.STAGE_BECAME_STALE:
      return payload.leadId ? leadDeepLink(String(payload.leadId), "stage") : null;
    case DOMAIN_EVENT.LEAD_ASSIGNED:
      return payload.leadId ? leadDeepLink(String(payload.leadId)) : null;
    case DOMAIN_EVENT.TASK_ASSIGNED:
    case DOMAIN_EVENT.TASK_DUE_SOON:
    case DOMAIN_EVENT.TASK_OVERDUE:
      return payload.taskId ? taskDeepLink(String(payload.taskId)) : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Recipient resolution (spec Sections 16–18) — a separate layer, never
// hardcoded inside the SLA engines.
// ---------------------------------------------------------------------------

export interface RecipientContext {
  /** Org owner/admin fallback (first OWNER, then ADMIN, then any active user). */
  orgFallbackUserId: string | null;
}

/**
 * Resolve notification recipients from the event itself.
 * Rules (Section 17, MVP fallback CHAINS — the first non-null recipient wins):
 *   FIRST_RESPONSE_BREACHED / STAGE_*  → lead owner → org owner/admin
 *   FOLLOW_UP_* / TASK_*               → task assignee → lead owner → org owner
 *   LEAD_ASSIGNED                      → the new assignee
 *   TASK_ASSIGNED                      → the task assignee
 * The projector still supports N recipients per event (Section 15) — the
 * chain policy above simply yields one recipient in practice; a future
 * "notify manager AND owner" policy only changes this function.
 */
export function resolveNotificationRecipients(
  event: { type: string; payload?: unknown },
  ctx: RecipientContext
): string[] {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const assigneeId = typeof p.assigneeId === "string" ? p.assigneeId : null;
  const ownerId = typeof p.ownerId === "string" ? p.ownerId : null;
  const fallback = ctx.orgFallbackUserId;

  let chain: (string | null)[];
  switch (event.type as DomainEventType) {
    case DOMAIN_EVENT.LEAD_ASSIGNED:
    case DOMAIN_EVENT.TASK_ASSIGNED:
      chain = [assigneeId];
      break;
    case DOMAIN_EVENT.FOLLOW_UP_DUE_SOON:
    case DOMAIN_EVENT.FOLLOW_UP_OVERDUE:
    case DOMAIN_EVENT.TASK_DUE_SOON:
    case DOMAIN_EVENT.TASK_OVERDUE:
      chain = [assigneeId, ownerId, fallback];
      break;
    default:
      chain = [ownerId, fallback];
      break;
  }
  const first = chain.find((id) => id != null && id.length > 0);
  return first ? [first] : [];
}

/** Org fallback recipient: first OWNER, then ADMIN, then any ACTIVE user. */
export async function getOrgFallbackRecipient(orgId: string): Promise<string | null> {
  const owner = await db.user.findFirst({
    where: { organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (owner) return owner.id;
  const admin = await db.user.findFirst({
    where: { organizationId: orgId, role: "ADMIN", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (admin) return admin.id;
  const any = await db.user.findFirst({
    where: { organizationId: orgId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return any?.id ?? null;
}

// ---------------------------------------------------------------------------
// Preferences (per-user) — loaded once per projector batch
// ---------------------------------------------------------------------------

export type PrefsCache = Map<string, NotificationPreferences>;

export async function getPreferencesFor(
  orgId: string,
  userIds: string[],
  cache?: PrefsCache
): Promise<Map<string, NotificationPreferences>> {
  const result: Map<string, NotificationPreferences> = new Map();
  const missing: string[] = [];
  for (const uid of userIds) {
    const hit = cache?.get(uid);
    if (hit) result.set(uid, hit);
    else missing.push(uid);
  }
  if (!missing.length) return result;
  // v0.17: PERSONAL preferences — UserNotificationPreference rows (one
  // batched query per projector run; orgId kept for signature stability).
  const rows = await db.userNotificationPreference.findMany({
    where: { userId: { in: missing } },
  });
  for (const uid of missing) {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    for (const row of rows) {
      if (row.userId === uid && row.eventType in prefs) {
        (prefs as Record<string, boolean>)[row.eventType] = row.inApp;
      }
    }
    result.set(uid, prefs);
    cache?.set(uid, prefs);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Projector (spec Section 30): event → notifications, idempotently
// ---------------------------------------------------------------------------

export interface ProjectionResult {
  notificationsCreated: number;
  recipients: string[];
  skippedByPreference: number;
}

/**
 * Project ONE event into notifications:
 *  1. resolve recipients,
 *  2. filter by per-user delivery preferences (event ≠ delivery, Section 99),
 *  3. create notifications idempotently (unique(eventId, userId)),
 *  4. stamp processedAt so a crash can be recovered by re-projection.
 */
export async function projectEventToNotifications(
  event: DomainEvent,
  opts: { orgFallbackUserId?: string | null; prefsCache?: PrefsCache } = {}
): Promise<ProjectionResult> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const ctx: RecipientContext = {
    orgFallbackUserId: opts.orgFallbackUserId ?? (await getOrgFallbackRecipient(event.organizationId)),
  };
  const recipients = resolveNotificationRecipients(event, ctx);

  if (!recipients.length) {
    await db.domainEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { notificationsCreated: 0, recipients: [], skippedByPreference: 0 };
  }

  const prefsMap = await getPreferencesFor(event.organizationId, recipients, opts.prefsCache);

  const template = NOTIFICATION_TEMPLATES[event.type as DomainEventType];
  const severity: Severity = EVENT_SEVERITY[event.type as DomainEventType] ?? "INFO";
  const snapshot = renderEnglishSnapshot(event.type as DomainEventType, payload);
  const deepLink = deepLinkFor(event.type as DomainEventType, payload);
  // leadId is validated against the org so a deleted-lead FK can never break
  // the insert (payload is advisory, not a constraint).
  let leadId: string | null = typeof payload.leadId === "string" ? payload.leadId : null;
  if (leadId) {
    const lead = await db.lead.findUnique({ where: { id: leadId }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== event.organizationId) leadId = null;
  }

  let created = 0;
  let skipped = 0;
  for (const userId of recipients) {
    const prefs = prefsMap.get(userId);
    if (prefs && prefs[event.type as DomainEventType] === false) {
      skipped++;
      continue;
    }
    try {
      await db.notification.create({
        data: {
          organizationId: event.organizationId,
          userId,
          eventId: event.id,
          leadId,
          type: event.type,
          templateKey: template?.titleKey ?? null,
          payload: payload as Prisma.InputJsonValue,
          severity,
          entityType: event.entityType,
          entityId: event.entityId,
          deepLink,
          title: snapshot.title,
          message: snapshot.message,
          // createdAt mirrors the business moment so "5m ago" is honest.
          createdAt: event.occurredAt,
        },
      });
      created++;
    } catch (e) {
      // unique(eventId, userId) → duplicate projection: idempotent no-op.
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }

  await db.domainEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  return { notificationsCreated: created, recipients, skippedByPreference: skipped };
}

// ---------------------------------------------------------------------------
// Publisher (spec Sections 11–13): durable, idempotent event creation
// ---------------------------------------------------------------------------

export interface PublishDomainEventInput extends Omit<PlannedEvent, "ownerId" | "assigneeId"> {
  actorUserId?: string | null;
}

/**
 * Create a DomainEvent if its deduplicationKey does not exist yet (unique
(organizationId, deduplicationKey) protects against races), then project it.
 * Returns the event + whether it was newly created.
 */
export async function publishDomainEvent(
  orgId: string,
  input: PublishDomainEventInput
): Promise<{ event: DomainEvent; created: boolean; projection: ProjectionResult }> {
  let event: DomainEvent | null = null;
  let created = false;
  // CAUSATION (v0.15 spec 29): events published inside an automation
  // execution are stamped with that execution id — audit trail + loop
  // protection. Outside an automation this is a plain null.
  const autoCtx = getAutomationExecutionContext();
  try {
    event = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        actorUserId: input.actorUserId ?? null,
        occurredAt: input.occurredAt,
        payload: input.payload as Prisma.InputJsonValue,
        deduplicationKey: input.deduplicationKey,
        automationExecutionId: autoCtx?.executionId ?? null,
      },
    });
    created = true;
  } catch (e) {
    if ((e as { code?: string })?.code !== "P2002") throw e;
    event = await db.domainEvent.findUnique({
      where: { organizationId_deduplicationKey: { organizationId: orgId, deduplicationKey: input.deduplicationKey } },
    });
    if (!event) throw e;
  }

  // Already-processed events (re-publication of a known fact) are not
  // re-projected — the projector itself is idempotent, this is just cheaper.
  if (!created && event.processedAt) {
    return { event, created: false, projection: { notificationsCreated: 0, recipients: [], skippedByPreference: 0 } };
  }

  const projection = await projectEventToNotifications(event);
  return { event, created, projection };
}

// ---------------------------------------------------------------------------
// Crash recovery (spec Sections 88–92): re-project unprocessed events
// ---------------------------------------------------------------------------

export async function reprocessUnprocessedEvents(
  orgId: string,
  opts: { orgFallbackUserId?: string | null; prefsCache?: PrefsCache } = {}
): Promise<{ reprocessed: number; notificationsCreated: number }> {
  const pending = await db.domainEvent.findMany({
    where: { organizationId: orgId, processedAt: null },
    orderBy: { occurredAt: "asc" },
    take: 500,
  });
  let created = 0;
  for (const ev of pending) {
    const r = await projectEventToNotifications(ev, opts);
    created += r.notificationsCreated;
  }
  return { reprocessed: pending.length, notificationsCreated: created };
}

// ---------------------------------------------------------------------------
// Dev inspector helper (spec Section 86)
// ---------------------------------------------------------------------------

export async function listDomainEvents(
  orgId: string,
  opts: { page?: number; limit?: number; type?: string } = {}
): Promise<{ rows: DomainEvent[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const where: Prisma.DomainEventWhereInput = { organizationId: orgId };
  if (opts.type) where.type = opts.type;
  const [rows, total] = await Promise.all([
    db.domainEvent.findMany({ where, orderBy: { occurredAt: "desc" }, take: limit, skip: (page - 1) * limit }),
    db.domainEvent.count({ where }),
  ]);
  return { rows, total };
}

export type { Notification };

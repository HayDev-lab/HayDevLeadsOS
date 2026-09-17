// HAYDEV LEADOS — server-side NOTIFICATION service (v0.14).
//
// Owns everything notification-shaped EXCEPT projection (which lives in the
// domain-event projector): server-paginated listing, the server-side unread
// count (never computed in the browser), read semantics (READ ≠ RESOLVED —
// Sections 39/42), centralized automatic resolution (Sections 40–41) and the
// per-user delivery preferences (Sections 54–55).
//
// READ  — the user has SEEN the notification (readAt).
// RESOLVED — the underlying PROBLEM is no longer actual (resolvedAt).
// Resolution never deletes history (Section 42).

import { db } from "@/lib/db";
import { Prisma, type Notification } from "@prisma/client";
import {
  DOMAIN_EVENT,
  DOMAIN_EVENT_TYPES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  parseNotificationPreferences,
  validateNotificationPreferences,
  type DomainEventType,
  type NotificationPreferences,
} from "@/lib/domain-events";
import {
  parseChannelPreferences,
  validateChannelPreferences,
  type ChannelPreferences,
} from "./delivery/channels";

// ---------------------------------------------------------------------------
// Preferences storage (Section 55): a real persistent User model exists, so
// preferences are USER-SCOPED Setting rows keyed "notification_preferences:<userId>".
// v0.16: the SAME row carries the event × channel matrix under `.channels`
// (external channels default OFF — spec 98). Backward compatible: legacy rows
// without `.channels` parse to all-OFF.
// ---------------------------------------------------------------------------

export function notificationPreferencesSettingKey(userId: string): string {
  return `notification_preferences:${userId}`;
}

/** Combined read model: in-app toggles + external channel matrix (spec 38–40). */
export interface FullNotificationPreferences {
  types: NotificationPreferences;
  channels: ChannelPreferences;
}

export async function getNotificationPreferences(orgId: string, userId: string): Promise<NotificationPreferences> {
  const row = await db.setting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: notificationPreferencesSettingKey(userId) } },
  });
  return parseNotificationPreferences(row?.value ?? null);
}

export async function getChannelPreferences(orgId: string, userId: string): Promise<ChannelPreferences> {
  const row = await db.setting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: notificationPreferencesSettingKey(userId) } },
  });
  return parseChannelPreferences(row?.value ?? null);
}

/** Save types and/or channels ATOMICALLY into the single preference row. */
export async function setNotificationPreferences(
  orgId: string,
  userId: string,
  prefs: NotificationPreferences,
  channels?: ChannelPreferences
): Promise<FullNotificationPreferences> {
  const key = notificationPreferencesSettingKey(userId);
  const existing = await db.setting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key } },
    select: { value: true },
  });
  const storedChannels = parseChannelPreferences(existing?.value ?? null);
  const value = {
    ...(existing?.value != null && typeof existing.value === "object" && !Array.isArray(existing.value)
      ? (existing.value as Record<string, unknown>)
      : {}),
    ...prefs,
    channels: channels ?? storedChannels,
  };
  await db.setting.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
  return { types: parseNotificationPreferences(value), channels: parseChannelPreferences(value) };
}

export function isValidPreferenceInput(raw: unknown) {
  return validateNotificationPreferences(raw);
}

export function isValidChannelPreferenceInput(raw: unknown) {
  return validateChannelPreferences(raw);
}

// ---------------------------------------------------------------------------
// Listing (server pagination — Section 73) + server-side unread count (38)
// ---------------------------------------------------------------------------

export type NotificationFilter = "all" | "unread" | "critical" | "resolved";

export interface NotificationListRow extends Notification {
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null } | null;
}

function listWhere(orgId: string, userId: string, filter: NotificationFilter): Prisma.NotificationWhereInput {
  // Tenant isolation (Section 70): always org-scoped; recipients see their own
  // rows plus org-wide broadcasts (userId = null, legacy seed rows).
  const scope = { organizationId: orgId, OR: [{ userId }, { userId: null }] };
  switch (filter) {
    case "unread":
      return { ...scope, readAt: null };
    case "critical":
      return { ...scope, severity: "CRITICAL" };
    case "resolved":
      return { ...scope, resolvedAt: { not: null } };
    default:
      return scope;
  }
}

export async function listNotifications(
  orgId: string,
  userId: string,
  opts: { filter?: NotificationFilter; page?: number; limit?: number } = {}
): Promise<{ rows: NotificationListRow[]; total: number; page: number; limit: number; pages: number; unread: number }> {
  const filter = opts.filter ?? "all";
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const where = listWhere(orgId, userId, filter);
  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({
      where,
      include: { lead: { select: { id: true, firstName: true, lastName: true, company: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: (page - 1) * limit,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { organizationId: orgId, OR: [{ userId }, { userId: null }], readAt: null } }),
  ]);
  return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), unread };
}

/** Unread count — SERVER-side, per recipient (Section 38). */
export async function countUnreadNotifications(orgId: string, userId: string): Promise<number> {
  return db.notification.count({
    where: { organizationId: orgId, OR: [{ userId }, { userId: null }], readAt: null },
  });
}

/** Recent notifications for the bell popover (last N). */
export async function recentNotifications(orgId: string, userId: string, take = 8): Promise<NotificationListRow[]> {
  return db.notification.findMany({
    where: { organizationId: orgId, OR: [{ userId }, { userId: null }] },
    include: { lead: { select: { id: true, firstName: true, lastName: true, company: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
}

// ---------------------------------------------------------------------------
// Read semantics (Sections 37, 68–69)
// ---------------------------------------------------------------------------

/**
 * Mark ONE notification read for the CURRENT recipient only (Section 71:
 * recipient identity comes from the session, never from the request body).
 * Returns false when the row does not exist / belongs to someone else.
 */
export async function markNotificationRead(orgId: string, userId: string, id: string): Promise<boolean> {
  const now = new Date();
  const res = await db.notification.updateMany({
    where: { id, organizationId: orgId, OR: [{ userId }, { userId: null }], readAt: null },
    data: { readAt: now, read: true },
  });
  return res.count > 0;
}

/** Mark ALL read — only the CURRENT recipient's rows (Section 69). */
export async function markAllNotificationsRead(orgId: string, userId: string): Promise<number> {
  const res = await db.notification.updateMany({
    where: { organizationId: orgId, OR: [{ userId }, { userId: null }], readAt: null },
    data: { readAt: new Date(), read: true },
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// Automatic resolution (Sections 29, 40–42) — centralized, never raw Prisma
// updates scattered across UI/API code.
// ---------------------------------------------------------------------------

/**
 * Resolve ACTIVE notifications of the given types for an entity.
 * A notification stays in history (never deleted); resolvedAt is stamped so
 * the default active views drop it and the RESOLVED badge can render.
 *
 * Recipients: ALL recipients of the org (the problem is gone for everyone).
 */
export async function resolveNotificationsForEntity(
  orgId: string,
  input: {
    /** Event types whose notifications should be resolved. */
    types: DomainEventType[];
    /** Lead-scoped resolution (FIRST_RESPONSE_*, STAGE_*, and follow-ups of this lead). */
    leadId?: string;
    /** Task-scoped resolution (FOLLOW_UP_*, TASK_*). */
    taskId?: string;
  }
): Promise<number> {
  if (!input.types.length) return 0;
  const where: Prisma.NotificationWhereInput = {
    organizationId: orgId,
    type: { in: input.types },
    resolvedAt: null,
  };
  // A task-scoped resolution targets notifications whose entityId is the task
  // (FOLLOW_UP_* / TASK_*); a lead-scoped one targets rows linked to the lead.
  const conditions: Prisma.NotificationWhereInput[] = [];
  if (input.leadId) conditions.push({ leadId: input.leadId });
  if (input.taskId) conditions.push({ entityType: "task", entityId: input.taskId });
  if (!conditions.length) return 0;
  where.OR = conditions;
  const res = await db.notification.updateMany({
    where,
    data: { resolvedAt: new Date() },
  });
  return res.count;
}

/** Convenience: resolve every follow-up problem for a task (or a lead's tasks). */
export function resolveFollowUpNotifications(orgId: string, taskId?: string, leadId?: string): Promise<number> {
  return resolveNotificationsForEntity(orgId, {
    types: [DOMAIN_EVENT.FOLLOW_UP_DUE_SOON, DOMAIN_EVENT.FOLLOW_UP_OVERDUE],
    taskId,
    leadId,
  });
}

/** Convenience: resolve both stage problems for a lead. */
export function resolveStageNotifications(orgId: string, leadId: string): Promise<number> {
  return resolveNotificationsForEntity(orgId, {
    types: [DOMAIN_EVENT.STAGE_AGING, DOMAIN_EVENT.STAGE_BECAME_STALE],
    leadId,
  });
}

/** Convenience: resolve the first-response breach for a lead. */
export function resolveFirstResponseNotifications(orgId: string, leadId: string): Promise<number> {
  return resolveNotificationsForEntity(orgId, {
    types: [DOMAIN_EVENT.FIRST_RESPONSE_BREACHED],
    leadId,
  });
}

/** Convenience: resolve generic-task problems for a task. */
export function resolveTaskNotifications(orgId: string, taskId: string): Promise<number> {
  return resolveNotificationsForEntity(orgId, {
    types: [DOMAIN_EVENT.TASK_DUE_SOON, DOMAIN_EVENT.TASK_OVERDUE],
    taskId,
  });
}

/** Resolve every monitored problem for a lead (archive / final stage policy). */
export async function resolveAllLeadProblems(orgId: string, leadId: string): Promise<number> {
  const a = await resolveNotificationsForEntity(orgId, {
    types: [
      DOMAIN_EVENT.FIRST_RESPONSE_BREACHED,
      DOMAIN_EVENT.FOLLOW_UP_DUE_SOON,
      DOMAIN_EVENT.FOLLOW_UP_OVERDUE,
      DOMAIN_EVENT.STAGE_AGING,
      DOMAIN_EVENT.STAGE_BECAME_STALE,
    ],
    leadId,
  });
  return a;
}

export { DOMAIN_EVENT_TYPES, DEFAULT_NOTIFICATION_PREFERENCES };

// HAYDEV LEADOS — server-side FOLLOW-UP SLA service.
// Bridges the pure engine (lib/sla-followup.ts) with Prisma + Settings + Tasks.
// Guarantees: config loaded ONCE per request; follow-up task map fetched with
// TWO queries per batch (open tasks + latest completed) — never per lead.
//
// Follow-up deadline source of truth: Task.type = "FOLLOW_UP", Task.dueAt.
// Completion source of truth: Task.status = DONE (+ completedAt).

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  OPEN_TASK_STATUSES,
  FOLLOW_UP_TASK_TYPE,
  FOLLOWUP_SLA_STATUS,
  compareLeadsByFollowUpUrgency,
  computeFollowUpSla,
  parseFollowUpConfig,
  type FollowUpSlaConfig,
  type FollowUpSlaResult,
  type FollowUpSlaStatus,
  type FollowUpTaskInput,
} from "@/lib/sla-followup";
import { QUALIFYING_ACTIVITY_TYPES } from "@/lib/sla";
import { ACTIVITY_TYPE, LEAD_EVENT } from "@/lib/leados/constants";
import { publishEvent } from "@/lib/leados/events";

export const FOLLOWUP_SETTING_KEY = "followup_sla";

/** In-memory cache of parsed config per org (short TTL, same pattern as SLA thresholds). */
const CACHE_TTL_MS = 15_000;
const configCache = new Map<string, { value: FollowUpSlaConfig; at: number }>();

/**
 * Resolve the follow-up SLA config for an organization.
 * 1. reads the Setting row (org-scoped — tenant safe),
 * 2. parses + validates it (backfilling optional fields),
 * 3. falls back to DEFAULT_FOLLOWUP_SLA_CONFIG when absent/invalid,
 * 4. short-lived in-memory cache — never re-reads settings per lead.
 */
export async function getFollowUpConfig(orgId: string): Promise<FollowUpSlaConfig> {
  const cached = configCache.get(orgId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let config: FollowUpSlaConfig | null = null;
  try {
    const row = await db.setting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: FOLLOWUP_SETTING_KEY } },
    });
    if (row?.value != null) {
      config = parseFollowUpConfig(row.value);
      if (!config) {
        console.warn(
          `[FOLLOWUP-SLA] invalid stored "${FOLLOWUP_SETTING_KEY}" for org ${orgId} — falling back to defaults`,
          row.value
        );
      }
    }
  } catch (e) {
    console.warn("[FOLLOWUP-SLA] settings read failed — falling back to defaults", e);
  }

  const value = config ?? { warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false };
  configCache.set(orgId, { value, at: Date.now() });
  return value;
}

/** Invalidate the cached config (called after settings are saved). */
export function invalidateFollowUpConfigCache(orgId?: string): void {
  if (orgId) configCache.delete(orgId);
  else configCache.clear();
}

// ---------------------------------------------------------------------------
// Follow-up task map (batch — max TWO queries per batch, never per lead)
// ---------------------------------------------------------------------------

export interface FollowUpTaskPair {
  /** Earliest open follow-up task by dueAt asc (nulls last). */
  open: FollowUpTaskInput | null;
  /** Most recently completed follow-up task. */
  lastCompleted: FollowUpTaskInput | null;
}

const dueTime = (t: FollowUpTaskInput) => (t.dueAt ? new Date(t.dueAt).getTime() : Number.POSITIVE_INFINITY);

/**
 * ONE query for open tasks + ONE for completed tasks across the whole lead
 * batch, grouped per lead in JS. `firstResponseMap` comes from the existing
 * SLA service query (shared — no extra reads).
 */
export async function getFollowUpTaskMap(
  orgId: string,
  leadIds: string[]
): Promise<Map<string, FollowUpTaskPair>> {
  const map = new Map<string, FollowUpTaskPair>();
  if (!leadIds.length) return map;
  for (const id of leadIds) map.set(id, { open: null, lastCompleted: null });

  const [openRows, doneRows] = await Promise.all([
    db.task.findMany({
      where: {
        organizationId: orgId,
        leadId: { in: leadIds },
        type: FOLLOW_UP_TASK_TYPE,
        status: { in: OPEN_TASK_STATUSES },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    }),
    db.task.findMany({
      where: {
        organizationId: orgId,
        leadId: { in: leadIds },
        type: FOLLOW_UP_TASK_TYPE,
        status: "DONE",
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  for (const t of openRows) {
    if (!t.leadId) continue;
    const pair = map.get(t.leadId);
    if (pair && (!pair.open || dueTime(t) < dueTime(pair.open))) pair.open = t;
  }
  for (const t of doneRows) {
    if (!t.leadId) continue;
    const pair = map.get(t.leadId);
    if (pair && !pair.lastCompleted) pair.lastCompleted = t;
  }
  return map;
}

type FollowUpLeadRow = {
  id: string;
  createdAt: Date;
  /** Lead.status — always present on real rows; missing defaults to active. */
  status?: string;
  [k: string]: unknown;
};

/** Attach a computed `followUp` object to every row (mutates by adding `followUp`). */
export function attachFollowUpToLeads<T extends FollowUpLeadRow>(
  rows: T[],
  config: FollowUpSlaConfig,
  taskMap: Map<string, FollowUpTaskPair>,
  firstResponseMap: Map<string, Date>
): (T & { followUp: FollowUpSlaResult })[] {
  const now = new Date();
  return rows.map((row) => {
    const pair = taskMap.get(row.id) ?? { open: null, lastCompleted: null };
    const followUp = computeFollowUpSla(
      {
        leadStatus: row.status ?? "OPEN",
        firstResponseAt: firstResponseMap.get(row.id) ?? null,
        openTask: pair.open,
        lastCompleted: pair.lastCompleted,
      },
      config,
      now
    );
    return { ...row, followUp };
  });
}

// ---------------------------------------------------------------------------
// Server-side filtering (Prisma where fragments — full dataset, paginated)
// ---------------------------------------------------------------------------

const ACTIVE_LEAD = { status: { notIn: ["WON", "LOST", "ARCHIVED"] } };
const HAS_RESPONSE = { activities: { some: { type: { in: QUALIFYING_ACTIVITY_TYPES } } } };
const OPEN_FU = { type: FOLLOW_UP_TASK_TYPE, status: { in: OPEN_TASK_STATUSES } };

/**
 * Prisma `where` fragment for server-side follow-up filtering. Mirrors the
 * engine exactly: active lead + responded for live states, defensive parity
 * for every status. "NONE" = no follow-up at all. Works with pagination/counts.
 */
export function followUpFilterWhere(
  status: FollowUpSlaStatus | "NONE",
  warningBeforeHours: number
): Record<string, unknown> {
  const now = new Date();
  const warnCutoff = new Date(now.getTime() + warningBeforeHours * 3_600_000);
  switch (status) {
    case FOLLOWUP_SLA_STATUS.OVERDUE:
      return {
        AND: [ACTIVE_LEAD, HAS_RESPONSE, { tasks: { some: { ...OPEN_FU, dueAt: { lt: now } } } }],
      };
    case FOLLOWUP_SLA_STATUS.DUE_SOON:
      return {
        AND: [
          ACTIVE_LEAD,
          HAS_RESPONSE,
          { tasks: { some: { ...OPEN_FU, dueAt: { gt: now, lte: warnCutoff } } } },
          { tasks: { none: { ...OPEN_FU, dueAt: { lt: now } } } },
        ],
      };
    case FOLLOWUP_SLA_STATUS.SCHEDULED:
      return {
        AND: [
          ACTIVE_LEAD,
          HAS_RESPONSE,
          { tasks: { some: OPEN_FU } },
          { tasks: { none: { ...OPEN_FU, dueAt: { lte: warnCutoff } } } },
        ],
      };
    case FOLLOWUP_SLA_STATUS.COMPLETED:
      return {
        AND: [
          ACTIVE_LEAD,
          HAS_RESPONSE,
          { tasks: { none: OPEN_FU } },
          { tasks: { some: { type: FOLLOW_UP_TASK_TYPE, status: "DONE" } } },
        ],
      };
    case "NONE":
      // No follow-up at all (never scheduled — final/unresponded leads included).
      return { tasks: { none: { type: FOLLOW_UP_TASK_TYPE } } };
    default:
      return {};
  }
}

/** "Due today" boundaries in the ORG timezone (storage stays UTC). */
export function todayRange(timezone: string, now: Date = new Date()): { start: Date; end: Date } {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const ymd = fmt.format(now); // YYYY-MM-DD in org tz
    // Interpret that calendar date in the org timezone → UTC instants.
    const tzOffsetMin = tzOffsetMinutes(timezone, now);
    const startUtc = new Date(`${ymd}T00:00:00Z`);
    startUtc.setTime(startUtc.getTime() - tzOffsetMin * 60_000);
    const end = new Date(startUtc.getTime() + 24 * 3_600_000);
    return { start: startUtc, end };
  } catch {
    // Unknown timezone — fall back to UTC day boundaries.
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return { start, end: new Date(start.getTime() + 24 * 3_600_000) };
  }
}

function tzOffsetMinutes(timezone: string, at: Date): number {
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
}

/** Follow-up filter fragment for "due today" (earliest open FU task due today). */
export function followUpTodayFilterWhere(timezone: string): Record<string, unknown> {
  const { start, end } = todayRange(timezone);
  return {
    AND: [
      ACTIVE_LEAD,
      { tasks: { some: { ...OPEN_FU, dueAt: { gte: start, lt: end } } } },
      { tasks: { none: { ...OPEN_FU, dueAt: { lt: start } } } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Dashboard counts (KPI click == filter count, by construction)
// ---------------------------------------------------------------------------

export async function countFollowUpsOverdue(orgId: string): Promise<number> {
  const config = await getFollowUpConfig(orgId);
  return db.lead.count({
    where: { organizationId: orgId, ...followUpFilterWhere(FOLLOWUP_SLA_STATUS.OVERDUE, config.warningBeforeHours) },
  });
}

export async function countFollowUpsDueToday(orgId: string, timezone: string): Promise<number> {
  return db.lead.count({
    where: { organizationId: orgId, ...followUpTodayFilterWhere(timezone) },
  });
}

/**
 * Sort helper for follow-up urgency ordering with server pagination.
 * Same 2-phase pattern as the first-response SLA sort: light fetch → compute →
 * rank in JS → hydrate only the requested page.
 */
export async function sortLeadIdsByFollowUpUrgency(
  orgId: string,
  where: Record<string, unknown>,
  config: FollowUpSlaConfig,
  page: number,
  limit: number
): Promise<{
  ids: string[];
  total: number;
  taskMap: Map<string, FollowUpTaskPair>;
  firstResponseMap: Map<string, Date>;
}> {
  const [light, total] = await Promise.all([
    db.lead.findMany({ where, select: { id: true, createdAt: true, status: true } }),
    db.lead.count({ where }),
  ]);
  const ids = light.map((l) => l.id);
  const [taskMap, firstResponseMap] = await Promise.all([
    getFollowUpTaskMap(orgId, ids),
    db.activity
      .groupBy({
        by: ["leadId"],
        where: { organizationId: orgId, leadId: { in: ids }, type: { in: QUALIFYING_ACTIVITY_TYPES } },
        _min: { createdAt: true },
      })
      .then((rows) => {
        const m = new Map<string, Date>();
        for (const r of rows) if (r._min.createdAt) m.set(r.leadId, r._min.createdAt);
        return m;
      }),
  ]);
  const { compareLeadsByFollowUpUrgency: cmp } = { compareLeadsByFollowUpUrgency };
  const now = new Date();
  const ranked = light
    .map((l) => {
      const pair = taskMap.get(l.id) ?? { open: null, lastCompleted: null };
      return {
        id: l.id,
        createdAt: l.createdAt,
        followUp: computeFollowUpSla(
          {
            leadStatus: l.status,
            firstResponseAt: firstResponseMap.get(l.id) ?? null,
            openTask: pair.open,
            lastCompleted: pair.lastCompleted,
          },
          config,
          now
        ),
      };
    })
    .sort(cmp);
  const pageIds = ranked.slice((page - 1) * limit, page * limit).map((r) => r.id);
  return { ids: pageIds, total, taskMap, firstResponseMap };
}

// ---------------------------------------------------------------------------
// Mutations: schedule / complete / reschedule / cancel (source-of-truth ops)
// ---------------------------------------------------------------------------

async function logFollowUpActivity(
  orgId: string,
  leadId: string,
  userId: string | null,
  action: "SCHEDULED" | "COMPLETED" | "RESCHEDULED" | "CANCELLED",
  data: {
    taskId: string;
    dueAt: Date | null;
    previousDueAt?: Date | null;
    completedAt?: Date | null;
    note?: string | null;
  }
) {
  const titles: Record<typeof action, string> = {
    SCHEDULED: "Follow-up scheduled",
    COMPLETED: "Follow-up completed",
    RESCHEDULED: "Follow-up rescheduled",
    CANCELLED: "Follow-up cancelled",
  };
  await db.activity.create({
    data: {
      organizationId: orgId,
      leadId,
      userId,
      type: ACTIVITY_TYPE.FOLLOW_UP,
      title: titles[action],
      description: data.note ?? null,
      metadata: {
        action,
        taskId: data.taskId,
        dueAt: data.dueAt?.toISOString() ?? null,
        previousDueAt: data.previousDueAt?.toISOString() ?? null,
        completedAt: data.completedAt?.toISOString() ?? null,
      } as Prisma.InputJsonValue,
    },
  });
  const eventMap = {
    SCHEDULED: LEAD_EVENT.FOLLOW_UP_SCHEDULED,
    COMPLETED: LEAD_EVENT.FOLLOW_UP_COMPLETED,
    RESCHEDULED: LEAD_EVENT.FOLLOW_UP_RESCHEDULED,
    CANCELLED: LEAD_EVENT.FOLLOW_UP_CANCELLED,
  } as const;
  await publishEvent({
    orgId,
    leadId,
    userId,
    type: eventMap[action],
    payload: {
      taskId: data.taskId,
      dueAt: data.dueAt?.toISOString() ?? null,
      previousDueAt: data.previousDueAt?.toISOString() ?? null,
    } as Prisma.InputJsonValue,
  });
}

/** Find the current open follow-up task for a lead (earliest dueAt). */
export async function findOpenFollowUpTask(
  orgId: string,
  leadId: string
): Promise<FollowUpTaskInput | null> {
  const tasks = await db.task.findMany({
    where: { organizationId: orgId, leadId, type: FOLLOW_UP_TASK_TYPE, status: { in: OPEN_TASK_STATUSES } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: 1,
  });
  return tasks[0] ?? null;
}

/** Schedule a NEW follow-up cycle. Rejects when an open one already exists. */
export async function scheduleFollowUp(
  orgId: string,
  leadId: string,
  userId: string | null,
  input: { dueAt: Date; note?: string | null; assignedTo?: string | null }
) {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { status: true, ownerId: true } });
  if (!lead || lead.status === "ARCHIVED") throw new Error("LEAD_NOT_FOUND");
  if (lead.status === "WON" || lead.status === "LOST") {
    throw new Error("LEAD_FINAL_STAGE");
  }
  const existing = await findOpenFollowUpTask(orgId, leadId);
  if (existing) throw new Error("OPEN_FOLLOW_UP_EXISTS");

  const task = await db.task.create({
    data: {
      organizationId: orgId,
      leadId,
      assignedTo: input.assignedTo ?? lead.ownerId ?? userId,
      title: "Follow up",
      description: input.note ?? null,
      type: FOLLOW_UP_TASK_TYPE,
      status: "TODO",
      dueAt: input.dueAt,
    },
  });
  await logFollowUpActivity(orgId, leadId, userId, "SCHEDULED", { taskId: task.id, dueAt: input.dueAt, note: input.note ?? null });
  return task;
}

/** Complete the CURRENT follow-up cycle (or a given open one). Task completion is the source of truth. */
export async function completeFollowUp(
  orgId: string,
  leadId: string,
  userId: string | null,
  taskId?: string
) {
  const target = taskId
    ? await db.task.findFirst({ where: { id: taskId, organizationId: orgId, leadId, type: FOLLOW_UP_TASK_TYPE } })
    : await db.task.findFirst({
        where: { organizationId: orgId, leadId, type: FOLLOW_UP_TASK_TYPE, status: { in: OPEN_TASK_STATUSES } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      });
  if (!target) throw new Error("NO_OPEN_FOLLOW_UP");
  if (target.status === "DONE" || target.status === "CANCELLED") throw new Error("FOLLOW_UP_ALREADY_CLOSED");

  const completedAt = new Date();
  const task = await db.task.update({ where: { id: target.id }, data: { status: "DONE", completedAt } });
  await logFollowUpActivity(orgId, leadId, userId, "COMPLETED", {
    taskId: task.id,
    dueAt: task.dueAt,
    completedAt,
  });
  return task;
}

/** Reschedule the current open follow-up — dueAt moves, history stays traceable via the timeline. */
export async function rescheduleFollowUp(
  orgId: string,
  leadId: string,
  userId: string | null,
  input: { dueAt: Date; note?: string | null; taskId?: string }
) {
  const target = input.taskId
    ? await db.task.findFirst({ where: { id: input.taskId, organizationId: orgId, leadId, type: FOLLOW_UP_TASK_TYPE } })
    : await db.task.findFirst({
        where: { organizationId: orgId, leadId, type: FOLLOW_UP_TASK_TYPE, status: { in: OPEN_TASK_STATUSES } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      });
  if (!target) throw new Error("NO_OPEN_FOLLOW_UP");
  if (target.status === "DONE" || target.status === "CANCELLED") throw new Error("FOLLOW_UP_ALREADY_CLOSED");

  const previousDueAt = target.dueAt;
  const task = await db.task.update({
    where: { id: target.id },
    data: { dueAt: input.dueAt, status: target.status === "TODO" ? "TODO" : target.status },
  });
  await logFollowUpActivity(orgId, leadId, userId, "RESCHEDULED", {
    taskId: task.id,
    dueAt: input.dueAt,
    previousDueAt,
    note: input.note ?? null,
  });
  return task;
}

/** Cancel open follow-up tasks (used by the cancel action). */
export async function cancelFollowUp(orgId: string, leadId: string, userId: string | null, taskId?: string) {
  const target = taskId
    ? await db.task.findFirst({ where: { id: taskId, organizationId: orgId, leadId, type: FOLLOW_UP_TASK_TYPE } })
    : await db.task.findFirst({
        where: { organizationId: orgId, leadId, type: FOLLOW_UP_TASK_TYPE, status: { in: OPEN_TASK_STATUSES } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      });
  if (!target) throw new Error("NO_OPEN_FOLLOW_UP");
  if (target.status === "DONE" || target.status === "CANCELLED") throw new Error("FOLLOW_UP_ALREADY_CLOSED");

  const task = await db.task.update({ where: { id: target.id }, data: { status: "CANCELLED" } });
  await logFollowUpActivity(orgId, leadId, userId, "CANCELLED", { taskId: task.id, dueAt: task.dueAt });
  return task;
}

/**
 * Final-stage policy (Won/Lost): cancel every OPEN follow-up task — rows are
 * kept for history; the engine also defensively ignores leftovers. Called
 * from changeStage when a lead enters a won/lost stage.
 */
export async function cancelFollowUpsForFinalStage(
  orgId: string,
  leadId: string,
  userId: string | null
): Promise<number> {
  const open = await db.task.findMany({
    where: { organizationId: orgId, leadId, type: FOLLOW_UP_TASK_TYPE, status: { in: OPEN_TASK_STATUSES } },
  });
  for (const t of open) {
    await db.task.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
    await logFollowUpActivity(orgId, leadId, userId, "CANCELLED", { taskId: t.id, dueAt: t.dueAt });
  }
  return open.length;
}

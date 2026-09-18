// HAYDEV LEADOS — server-side SLA service.
// Bridges the pure engine (lib/sla.ts) with Prisma + Settings.
// Guarantees: settings loaded ONCE per request, first-response activity map
// fetched with ONE grouped query per batch — never per lead.

import { db } from "@/lib/db";
import {
  DEFAULT_SLA_THRESHOLDS,
  QUALIFYING_ACTIVITY_TYPES,
  SLA_STATUS,
  computeFirstResponseSla,
  compareLeadsBySlaPriority,
  parseSlaThresholds,
  type SlaResult,
  type SlaStatus,
  type SlaThresholds,
} from "@/lib/sla";

export const SLA_SETTING_KEY = "sla_thresholds";

/** In-memory cache of parsed thresholds per org (short TTL to keep reads cheap).
 *  Stored on globalThis so every route handler shares ONE cache instance —
 *  dev-mode module duplication must never fork the cache or invalidation
 *  between routes would silently break (same pattern as the Prisma client). */
const CACHE_TTL_MS = 15_000;
const globalForSlaCache = globalThis as unknown as {
  __slaThresholdsCache?: Map<string, { value: SlaThresholds; at: number; fromDb: boolean }>;
};
const thresholdsCache = (globalForSlaCache.__slaThresholdsCache ??= new Map<string, { value: SlaThresholds; at: number; fromDb: boolean }>());

/**
 * Resolve SLA thresholds for an organization.
 * 1. reads the Setting row (org-scoped — tenant safe),
 * 2. parses + validates it,
 * 3. falls back to DEFAULT_SLA_THRESHOLDS when absent/invalid (never crashes),
 * 4. short-lived in-memory cache so the lead list never re-reads settings per lead.
 */
export async function getSlaThresholds(orgId: string): Promise<SlaThresholds> {
  const cached = thresholdsCache.get(orgId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let thresholds: SlaThresholds | null = null;
  try {
    const row = await db.setting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: SLA_SETTING_KEY } },
    });
    if (row?.value != null) {
      thresholds = parseSlaThresholds(row.value);
      if (!thresholds) {
        console.warn(`[SLA] invalid stored "${SLA_SETTING_KEY}" for org ${orgId} — falling back to defaults`, row.value);
      }
    }
  } catch (e) {
    console.warn("[SLA] settings read failed — falling back to defaults", e);
  }

  const value = thresholds ?? DEFAULT_SLA_THRESHOLDS;
  thresholdsCache.set(orgId, { value, at: Date.now(), fromDb: thresholds != null });
  return value;
}

/** Invalidate the cached thresholds (called after settings are saved). */
export function invalidateSlaThresholdsCache(orgId?: string): void {
  if (orgId) thresholdsCache.delete(orgId);
  else thresholdsCache.clear();
}

/**
 * ONE grouped query: earliest qualifying activity per lead.
 * Returns a map leadId → firstResponseAt. Activities that predate the lead
 * creation (merge artifacts) are treated as responses; elapsed is clamped >= 0
 * by the engine, so DB filters and computed statuses always agree.
 */
export async function getFirstResponseMap(
  orgId: string,
  leadIds: string[]
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (!leadIds.length) return map;
  const rows = await db.activity.groupBy({
    by: ["leadId"],
    where: {
      organizationId: orgId,
      leadId: { in: leadIds },
      type: { in: QUALIFYING_ACTIVITY_TYPES },
    },
    _min: { createdAt: true },
  });
  for (const r of rows) {
    if (r._min.createdAt) map.set(r.leadId, r._min.createdAt);
  }
  return map;
}

type SlaLeadRow = {
  id: string;
  createdAt: Date;
  [k: string]: unknown;
};

/** Attach a computed `sla` object to every row (mutates by adding `sla`). */
export function attachSlaToLeads<T extends SlaLeadRow>(
  rows: T[],
  thresholds: SlaThresholds,
  firstResponseMap: Map<string, Date>
): (T & { sla: SlaResult })[] {
  const now = new Date();
  return rows.map((row) => {
    const sla = computeFirstResponseSla(
      { createdAt: row.createdAt, firstResponseAt: firstResponseMap.get(row.id) ?? null },
      thresholds,
      now
    );
    return { ...row, sla };
  });
}

/**
 * Prisma `where` fragment for server-side SLA filtering.
 * Works with pagination and counts — never filters only the current page.
 */
export function slaFilterWhere(status: SlaStatus, thresholds: SlaThresholds) {
  const now = Date.now();
  const cutoff = (hours: number) => new Date(now - hours * 3_600_000);
  const unanswered = { activities: { none: { type: { in: QUALIFYING_ACTIVITY_TYPES } } } };
  switch (status) {
    case SLA_STATUS.RESPONDED:
      return { activities: { some: { type: { in: QUALIFYING_ACTIVITY_TYPES } } } };
    case SLA_STATUS.BREACH:
      return { AND: [unanswered, { createdAt: { lte: cutoff(thresholds.breach) } }] };
    case SLA_STATUS.WARNING:
      return {
        AND: [unanswered, { createdAt: { gt: cutoff(thresholds.breach), lte: cutoff(thresholds.target) } }],
      };
    case SLA_STATUS.TARGET:
      return { AND: [unanswered, { createdAt: { gt: cutoff(thresholds.target) } }] };
    default:
      return {};
  }
}

/** Count of SLA-breached leads for the org (dashboard KPI — real, not mocked). */
export async function countSlaBreached(orgId: string): Promise<number> {
  const thresholds = await getSlaThresholds(orgId);
  return db.lead.count({
    where: {
      organizationId: orgId,
      status: { not: "ARCHIVED" },
      ...slaFilterWhere(SLA_STATUS.BREACH, thresholds),
    },
  });
}

/**
 * Sort helper for SLA-priority ordering with server pagination.
 * Phase 1: fetch lightweight (id, createdAt) for ALL filtered leads.
 * Phase 2: one grouped activity query, compute SLA, rank in JS.
 * Returns the page slice of lead ids in SLA priority order.
 */
export async function sortLeadIdsBySlaPriority(
  orgId: string,
  where: Record<string, unknown>,
  thresholds: SlaThresholds,
  page: number,
  limit: number
): Promise<{ ids: string[]; total: number; firstResponseMap: Map<string, Date> }> {
  const [light, total] = await Promise.all([
    db.lead.findMany({ where, select: { id: true, createdAt: true } }),
    db.lead.count({ where }),
  ]);
  const firstResponseMap = await getFirstResponseMap(
    orgId,
    light.map((l) => l.id)
  );
  const now = new Date();
  const ranked = light
    .map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      sla: computeFirstResponseSla(
        { createdAt: l.createdAt, firstResponseAt: firstResponseMap.get(l.id) ?? null },
        thresholds,
        now
      ),
    }))
    .sort(compareLeadsBySlaPriority);
  const ids = ranked.slice((page - 1) * limit, page * limit).map((r) => r.id);
  return { ids, total, firstResponseMap };
}

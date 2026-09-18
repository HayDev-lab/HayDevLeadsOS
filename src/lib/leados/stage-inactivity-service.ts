// HAYDEV LEADOS — server-side STAGE INACTIVITY service.
// Bridges the pure engine (lib/sla-stage-inactivity.ts) with Prisma + Settings
// + Pipeline stages. Guarantees: config + stages loaded ONCE per request
// (short cache), computed per lead in JS (pure calculation — no Activity
// queries per lead), server-side filters with exact engine parity.
//
// Stage thresholds live in the Setting key "stage_inactivity", keyed by
// STAGE ID (survives renames). Final stages (won/lost) are never monitored.

import { db } from "@/lib/db";
import {
  STAGE_INACTIVITY_STATUS,
  computeStageInactivity,
  parseStageInactivityConfig,
  resolveStageThresholdHours,
  compareLeadsByStageInactivity,
  type StageInactivityConfig,
  type StageInactivityResult,
} from "@/lib/sla-stage-inactivity";

export const STAGE_INACTIVITY_SETTING_KEY = "stage_inactivity";

/** In-memory cache of the RESOLVED config per org (same TTL pattern as SLA).
 *  Stored on globalThis so every route handler shares ONE cache instance —
 *  dev-mode module duplication must never fork the cache or invalidation
 *  between routes would silently break (same pattern as the Prisma client). */
const CACHE_TTL_MS = 15_000;
const globalForSiCache = globalThis as unknown as {
  __stageInactivityConfigCache?: Map<string, { value: ResolvedStageInactivityConfig; at: number }>;
};
const configCache = (globalForSiCache.__stageInactivityConfigCache ??= new Map<string, { value: ResolvedStageInactivityConfig; at: number }>());

/**
 * Normalized config (Section 78): stored Setting merged with the org's real
 * pipeline stages. Every OPEN stage gets a resolved threshold (configured
 * value or the shared DEFAULT_STAGE_INACTIVITY_HOURS fallback); deleted stage
 * entries are ignored; `usingDefault` lists stages on the fallback so the
 * Settings UI can show "Using default" (Section 14).
 */
export interface ResolvedStageInactivityConfig {
  warningBeforeHours: number;
  /** stageId → resolved threshold hours (ALL open stages of the org). */
  thresholds: Record<string, number>;
  /** Open stages that had no configured threshold and use the shared default. */
  usingDefault: string[];
}

/**
 * Resolve the stage inactivity config for an organization.
 * 1. reads the org-scoped Setting row (tenant safe),
 * 2. parses + validates it (falling back to defaults, logging anomalies),
 * 3. loads the org's REAL pipeline stages — never hardcoded stage lists,
 * 4. resolves a threshold for every open stage (default fallback for new ones),
 * 5. short-lived in-memory cache — never re-reads per lead.
 */
export async function getStageInactivityConfig(orgId: string): Promise<ResolvedStageInactivityConfig> {
  const cached = configCache.get(orgId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let config: StageInactivityConfig | null = null;
  try {
    const row = await db.setting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: STAGE_INACTIVITY_SETTING_KEY } },
    });
    if (row?.value != null) {
      config = parseStageInactivityConfig(row.value);
      if (!config) {
        console.warn(
          `[STAGE-INACTIVITY] invalid stored "${STAGE_INACTIVITY_SETTING_KEY}" for org ${orgId} — falling back to defaults`,
          row.value
        );
      }
    }
  } catch (e) {
    console.warn("[STAGE-INACTIVITY] settings read failed — falling back to defaults", e);
  }

  const effective: StageInactivityConfig = config ?? { warningBeforeHours: 12, stages: {} };

  // Real stages of the org (all pipelines) — Settings follows the pipeline
  // (Section 13); a NEW stage automatically gets the default until configured.
  let openStages: { id: string }[] = [];
  try {
    openStages = await db.pipelineStage.findMany({
      where: { pipeline: { organizationId: orgId }, type: "open" },
      select: { id: true },
    });
  } catch (e) {
    console.warn("[STAGE-INACTIVITY] pipeline stages read failed", e);
  }

  const thresholds: Record<string, number> = {};
  const usingDefault: string[] = [];
  for (const s of openStages) {
    const stored = effective.stages[s.id];
    thresholds[s.id] = resolveStageThresholdHours(effective, s.id);
    if (!stored || !Number.isFinite(stored.thresholdHours) || stored.thresholdHours <= 0) {
      usingDefault.push(s.id);
    }
  }

  const value: ResolvedStageInactivityConfig = {
    warningBeforeHours: effective.warningBeforeHours,
    thresholds,
    usingDefault,
  };
  configCache.set(orgId, { value, at: Date.now() });
  return value;
}

/** Invalidate the cached config (called after settings are saved). */
export function invalidateStageInactivityConfigCache(orgId?: string): void {
  if (orgId) configCache.delete(orgId);
  else configCache.clear();
}

// ---------------------------------------------------------------------------
// Attach (pure calculation after fetching leads — no per-lead queries)
// ---------------------------------------------------------------------------

type StageInactivityLeadRow = {
  id: string;
  createdAt: Date;
  status?: string;
  stageId?: string | null;
  stageEnteredAt?: Date | string | null;
  stage?: { id: string; type: string } | null;
  [k: string]: unknown;
};

/** Engine config view of a resolved config (all stages configured). */
export function asEngineConfig(resolved: ResolvedStageInactivityConfig): StageInactivityConfig {
  const stages: Record<string, { thresholdHours: number }> = {};
  for (const [id, hours] of Object.entries(resolved.thresholds)) stages[id] = { thresholdHours: hours };
  return { warningBeforeHours: resolved.warningBeforeHours, stages };
}

/** Attach a computed `stageInactivity` object to every row. */
export function attachStageInactivityToLeads<T extends StageInactivityLeadRow>(
  rows: T[],
  resolved: ResolvedStageInactivityConfig,
  now: Date = new Date()
): (T & { stageInactivity: StageInactivityResult })[] {
  const config = asEngineConfig(resolved);
  return rows.map((row) => ({
    ...row,
    stageInactivity: computeStageInactivity(
      {
        leadStatus: row.status ?? "OPEN",
        stageId: row.stageId ?? null,
        stageType: row.stage?.type ?? null,
        stageEnteredAt: row.stageEnteredAt ?? null,
        createdAt: row.createdAt,
      },
      config,
      now
    ),
  }));
}

// ---------------------------------------------------------------------------
// Server-side filtering (Prisma where fragments — full dataset, paginated)
// ---------------------------------------------------------------------------

const ACTIVE_LEAD = { status: { notIn: ["WON", "LOST", "ARCHIVED"] } };
const OPEN_STAGE = { stage: { type: "open" } };

/** stageEnteredAt comparison with the createdAt fallback for legacy nulls. */
function enteredWhere(op: "lte" | "gt", cutoff: Date): Record<string, unknown> {
  return {
    OR: [
      { stageEnteredAt: { [op]: cutoff } },
      { stageEnteredAt: null, createdAt: { [op]: cutoff } },
    ],
  };
}

/**
 * Prisma `where` fragment for server-side stage health filtering. Mirrors the
 * engine exactly, per-stage (each stage has its own threshold). Works with
 * pagination/counts — never filters only the current page.
 */
export function stageHealthFilterWhere(
  status: keyof typeof STAGE_INACTIVITY_STATUS,
  resolved: ResolvedStageInactivityConfig
): Record<string, unknown> {
  const now = Date.now();
  const hoursMs = (h: number) => h * 3_600_000;
  const stageIds = Object.keys(resolved.thresholds);

  // Per-stage condition: entry timestamp satisfies the cutoff computed with
  // THAT stage's threshold (engine parity, including the null → createdAt
  // fallback for legacy rows).
  const perStage = (cutoffFor: (thresholdHours: number) => Date, op: "lte" | "gt") => ({
    OR: stageIds.map((id) => ({
      stageId: id,
      ...enteredWhere(op, cutoffFor(resolved.thresholds[id])),
    })),
  });

  switch (status) {
    case STAGE_INACTIVITY_STATUS.STALE:
      // age >= threshold
      return {
        AND: [ACTIVE_LEAD, OPEN_STAGE, perStage((h) => new Date(now - hoursMs(h)), "lte")],
      };
    case STAGE_INACTIVITY_STATUS.AGING: {
      // threshold - warning <= age < threshold
      const agingCutoff = (h: number) => new Date(now - hoursMs(Math.max(0, h - resolved.warningBeforeHours)));
      const staleCutoff = (h: number) => new Date(now - hoursMs(h));
      return {
        AND: [
          ACTIVE_LEAD,
          OPEN_STAGE,
          {
            OR: stageIds.map((id) => {
              const h = resolved.thresholds[id];
              return {
                stageId: id,
                AND: [enteredWhere("gt", staleCutoff(h)), enteredWhere("lte", agingCutoff(h))],
              };
            }),
          },
        ],
      };
    }
    case STAGE_INACTIVITY_STATUS.ON_TRACK: {
      // age < threshold - warning (strictly before the AGING window)
      const agingCutoff = (h: number) => new Date(now - hoursMs(Math.max(0, h - resolved.warningBeforeHours)));
      return {
        AND: [ACTIVE_LEAD, OPEN_STAGE, perStage(agingCutoff, "gt")],
      };
    }
    case STAGE_INACTIVITY_STATUS.NOT_APPLICABLE:
      // Final stages / final statuses / no stage at all.
      return {
        OR: [
          { stage: { type: "won" } },
          { stage: { type: "lost" } },
          { status: { in: ["WON", "LOST", "ARCHIVED"] } },
          { stageId: null },
        ],
      };
    default:
      return {};
  }
}

/** Count of STALE deals for the org (dashboard KPI — real, click == filter). */
export async function countStaleDeals(orgId: string): Promise<number> {
  const resolved = await getStageInactivityConfig(orgId);
  return db.lead.count({
    where: {
      organizationId: orgId,
      ...stageHealthFilterWhere(STAGE_INACTIVITY_STATUS.STALE, resolved),
    },
  });
}

// ---------------------------------------------------------------------------
// Sorting: stage inactivity urgency (2-phase, server pagination friendly)
// ---------------------------------------------------------------------------

/**
 * Sort helper for stage-inactivity ordering with server pagination.
 * Same 2-phase pattern: light fetch (with stage type) → compute → rank in JS
 * → hydrate only the requested page. Order: STALE (most overdue) → AGING
 * (closest to stale) → ON_TRACK (oldest) → NOT_APPLICABLE (newest).
 */
export async function sortLeadIdsByStageInactivity(
  orgId: string,
  where: Record<string, unknown>,
  resolved: ResolvedStageInactivityConfig,
  page: number,
  limit: number
): Promise<{ ids: string[]; total: number }> {
  const [light, total] = await Promise.all([
    db.lead.findMany({
      where,
      select: { id: true, createdAt: true, status: true, stageId: true, stageEnteredAt: true, stage: { select: { type: true } } },
    }),
    db.lead.count({ where }),
  ]);
  const config = asEngineConfig(resolved);
  const now = new Date();
  const ranked = light
    .map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      stageInactivity: computeStageInactivity(
        {
          leadStatus: l.status ?? "OPEN",
          stageId: l.stageId ?? null,
          stageType: l.stage?.type ?? null,
          stageEnteredAt: l.stageEnteredAt ?? null,
          createdAt: l.createdAt,
        },
        config,
        now
      ),
    }))
    .sort(compareLeadsByStageInactivity);
  const ids = ranked.slice((page - 1) * limit, page * limit).map((r) => r.id);
  return { ids, total };
}

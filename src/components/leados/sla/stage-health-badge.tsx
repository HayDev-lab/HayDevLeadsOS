"use client";

// Shared STAGE HEALTH badge — used by the Lead List, Lead Detail header, Kanban
// cards and the Settings preview, so every surface shows the SAME engine result
// (lib/sla-stage-inactivity.ts). Details are available via a click/keyboard
// popover (not hover-only).
// Visual model: On track = muted success · Aging = amber · Stale = red ·
// Not monitored = muted. Always text + color, never color-only (Section 99).

import { cn } from "@/lib/utils";
import { Hourglass, TimerOff, TrendingUp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocale } from "@/lib/leados/locale";
import { useSlaTick } from "@/hooks/leados/use-sla-tick";
import {
  STAGE_INACTIVITY_STATUS,
  computeStageInactivity,
  humanizeDuration,
  humanizeHours,
  type StageInactivityResult,
} from "@/lib/sla-stage-inactivity";

const STATUS_STYLE: Record<string, { icon: typeof Hourglass; classes: string }> = {
  [STAGE_INACTIVITY_STATUS.ON_TRACK]: {
    icon: TrendingUp,
    classes: "bg-emerald-50 text-emerald-700 border border-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60",
  },
  [STAGE_INACTIVITY_STATUS.AGING]: {
    icon: Hourglass,
    classes: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  [STAGE_INACTIVITY_STATUS.STALE]: {
    icon: TimerOff,
    classes: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  },
  [STAGE_INACTIVITY_STATUS.NOT_APPLICABLE]: {
    icon: Hourglass,
    classes: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
};

export function stageHealthStatusLabel(status: string, t: (k: any) => string): string {
  switch (status) {
    case STAGE_INACTIVITY_STATUS.ON_TRACK:
      return t("stage.on_track");
    case STAGE_INACTIVITY_STATUS.AGING:
      return t("stage.aging");
    case STAGE_INACTIVITY_STATUS.STALE:
      return t("stage.stale");
    default:
      return t("stage.not_applicable");
  }
}

function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Resolved config shape returned by the APIs ({thresholds: {stageId: hours}}). */
export interface ResolvedStageConfigView {
  warningBeforeHours: number;
  thresholds: Record<string, number>;
}

export interface StageHealthBadgeProps {
  leadStatus: string;
  stageId: string | null;
  stageName?: string | null;
  stageType?: string | null;
  stageEnteredAt?: Date | string | null;
  createdAt: Date | string;
  config?: ResolvedStageConfigView | null;
  /** Compact variant for dense surfaces (kanban cards, header). */
  compact?: boolean;
  /** When true renders nothing for quiet states (kanban: AGING/STALE only). */
  onlyUrgent?: boolean;
  /** When true renders nothing for NOT_APPLICABLE (lead list final rows). */
  hideNotApplicable?: boolean;
  className?: string;
}

export function StageHealthBadge({
  leadStatus,
  stageId,
  stageName,
  stageType,
  stageEnteredAt,
  createdAt,
  config,
  compact,
  onlyUrgent,
  hideNotApplicable,
  className,
}: StageHealthBadgeProps) {
  const { t } = useLocale();
  useSlaTick(); // one shared timer — stage ages stay live between refetches

  // Recomputed LOCALLY with the single engine — statuses stay live. The
  // compute is a handful of date comparisons — no memoization needed.
  const si: StageInactivityResult = computeStageInactivity(
    {
      leadStatus,
      stageId,
      stageType: stageType ?? null,
      stageEnteredAt: stageEnteredAt ?? null,
      createdAt,
    },
    {
      warningBeforeHours: config?.warningBeforeHours ?? 12,
      stages: Object.fromEntries(
        Object.entries(config?.thresholds ?? {}).map(([id, h]) => [id, { thresholdHours: h }])
      ),
    }
  );

  if (
    (onlyUrgent && si.status !== STAGE_INACTIVITY_STATUS.AGING && si.status !== STAGE_INACTIVITY_STATUS.STALE) ||
    (hideNotApplicable && si.status === STAGE_INACTIVITY_STATUS.NOT_APPLICABLE)
  ) {
    return null;
  }

  const style = STATUS_STYLE[si.status] ?? STATUS_STYLE[STAGE_INACTIVITY_STATUS.NOT_APPLICABLE];
  const Icon = style.icon;
  const label = stageHealthStatusLabel(si.status, t);

  // Text next to the label: current age for monitored states, overdue for STALE
  // (Section 23: "On track · 18h" / "Aging · 2d 14h" / "Stale · 6d").
  const duration =
    si.status === STAGE_INACTIVITY_STATUS.STALE
      ? humanizeDuration(si.overdueMinutes ?? 0)
      : si.status === STAGE_INACTIVITY_STATUS.NOT_APPLICABLE
      ? ""
      : humanizeDuration(si.stageAgeMinutes);

  const badge = (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${t("stage.title")}: ${label}${duration ? ` ${duration}` : ""}`}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        style.classes,
        className
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
      {duration && (
        <>
          <span className="opacity-60">·</span>
          <span className="tabular-nums">{duration}</span>
        </>
      )}
    </span>
  );

  if (compact) return badge;

  return (
    <Popover>
      <PopoverTrigger asChild>{badge}</PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-xs" align="start">
        <p className="mb-2 flex items-center gap-1.5 font-medium">
          <Hourglass className="h-3.5 w-3.5 text-muted-foreground" />
          {t("stage.title")}
        </p>
        <div className="space-y-1.5">
          {si.status === STAGE_INACTIVITY_STATUS.NOT_APPLICABLE ? (
            <p className="text-muted-foreground">{t("stage.not_monitored_hint")}</p>
          ) : (
            <>
              {stageName && <Row label={t("leads.col.stage")} value={stageName} />}
              <Row label={t("stage.entered_at")} value={formatDateTime(si.stageEnteredAt)} />
              <Row label={t("stage.stage_age")} value={humanizeDuration(si.stageAgeMinutes)} />
              <Row label={t("stage.expected_max")} value={`≤ ${humanizeHours((si.thresholdMinutes ?? 0) / 60)}`} />
              {si.status === STAGE_INACTIVITY_STATUS.STALE ? (
                <Row
                  label={t("stage.stale_by")}
                  value={humanizeDuration(si.overdueMinutes ?? 0)}
                  highlight="text-red-600 dark:text-red-400"
                />
              ) : si.status === STAGE_INACTIVITY_STATUS.AGING ? (
                <Row
                  label={t("stage.stale_in")}
                  value={humanizeDuration(si.remainingMinutes ?? 0)}
                  highlight="text-amber-600 dark:text-amber-400"
                />
              ) : (
                <Row label={t("stage.stale_in")} value={humanizeDuration(si.remainingMinutes ?? 0)} />
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", highlight)}>{value}</span>
    </div>
  );
}

"use client";

// Shared SLA badge — used by Lead List, Kanban and the Settings preview,
// so the preview can NEVER diverge from the production UI.
// Displays the SAME engine result (lib/sla.ts) that the API computes.
// Details are available via a click/keyboard popover (not hover-only).

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Clock, AlertTriangle, CheckCircle2, Timer } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocale } from "@/lib/leados/locale";
import { useSlaTick } from "@/hooks/leados/use-sla-tick";
import {
  DEFAULT_SLA_THRESHOLDS,
  SLA_STATUS,
  computeFirstResponseSla,
  humanizeDuration,
  humanizeHours,
  type SlaResult,
  type SlaThresholds,
} from "@/lib/sla";

// ---------------------------------------------------------------------------
// Visual model (colors + TEXT labels — never color-only, per accessibility)
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<string, { icon: typeof Clock; classes: string }> = {
  [SLA_STATUS.TARGET]: {
    icon: CheckCircle2,
    classes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  [SLA_STATUS.WARNING]: {
    icon: Clock,
    classes: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  [SLA_STATUS.BREACH]: {
    icon: AlertTriangle,
    classes: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  },
  [SLA_STATUS.RESPONDED]: {
    icon: CheckCircle2,
    classes: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
};

// Escalated WARNING (past the warning threshold, before breach) — orange tint.
const ESCALATED_CLASSES = "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300";

export function slaStatusLabel(status: string, t: (k: any) => string): string {
  switch (status) {
    case SLA_STATUS.TARGET:
      return t("sla.target");
    case SLA_STATUS.WARNING:
      return t("sla.warning");
    case SLA_STATUS.BREACH:
      return t("sla.breach");
    default:
      return t("sla.responded");
  }
}

function formatTime(d: Date | string): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

interface SlaBadgeProps {
  createdAt: Date | string;
  /** Earliest qualifying activity (from the API `sla.firstResponseAt`). */
  firstResponseAt?: Date | string | null;
  thresholds?: SlaThresholds | null;
  /** Compact variant for dense surfaces (kanban cards). */
  compact?: boolean;
  className?: string;
}

export function SlaBadge({ createdAt, firstResponseAt, thresholds, compact, className }: SlaBadgeProps) {
  const { t } = useLocale();
  useSlaTick(); // one shared timer — re-renders badges as time passes

  // Recomputed LOCALLY with the single engine — statuses stay live between
  // refetches (thresholds come from Settings via the API response).
  const sla: SlaResult = useMemo(
    () => computeFirstResponseSla({ createdAt, firstResponseAt: firstResponseAt ?? null }, thresholds ?? DEFAULT_SLA_THRESHOLDS),
    [createdAt, firstResponseAt, thresholds?.target, thresholds?.warning, thresholds?.breach]
  );

  const style = STATUS_STYLE[sla.status] ?? STATUS_STYLE[SLA_STATUS.RESPONDED];
  const Icon = style.icon;
  const label = slaStatusLabel(sla.status, t);
  const duration =
    sla.status === SLA_STATUS.RESPONDED
      ? humanizeDuration(sla.responseMinutes ?? 0)
      : humanizeDuration(sla.elapsedMinutes);
  const escalated = sla.status === SLA_STATUS.WARNING && sla.escalated;

  const badge = (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${t("sla.title")}: ${label} ${duration}`}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        escalated ? ESCALATED_CLASSES : style.classes,
        className
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
      <span className="opacity-60">·</span>
      <span className="tabular-nums">{duration}</span>
    </span>
  );

  if (compact) return badge;

  return (
    <Popover>
      <PopoverTrigger asChild>{badge}</PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-xs" align="start">
        <p className="mb-2 flex items-center gap-1.5 font-medium">
          <Timer className="h-3.5 w-3.5 text-muted-foreground" />
          {t("sla.title")}
        </p>
        <div className="space-y-1.5">
          <Row label={t("sla.created")} value={formatTime(sla.createdAt)} />
          <Row label={t("sla.target_at")} value={humanizeHours(thresholds?.target ?? DEFAULT_SLA_THRESHOLDS.target)} />
          <Row label={t("sla.warning_at")} value={humanizeHours(thresholds?.warning ?? DEFAULT_SLA_THRESHOLDS.warning)} />
          <Row label={t("sla.breach_at")} value={humanizeHours(thresholds?.breach ?? DEFAULT_SLA_THRESHOLDS.breach)} />
          {sla.isResponded ? (
            <>
              <Row
                label={t("sla.first_response")}
                value={humanizeDuration(sla.responseMinutes ?? 0)}
                highlight="text-emerald-600 dark:text-emerald-400"
              />
              <Row label={t("sla.responded_at")} value={formatTime(sla.firstResponseAt!)} />
            </>
          ) : (
            <>
              <Row
                label={t("sla.elapsed")}
                value={`${humanizeDuration(sla.elapsedMinutes)} ${t("sla.without_response")}`}
                highlight={sla.isBreached ? "text-red-600 dark:text-red-400" : undefined}
              />
              <Row
                label={sla.isBreached ? t("sla.breached_by") : t("sla.breach_in")}
                value={humanizeDuration(
                  sla.isBreached
                    ? sla.elapsedMinutes - Math.round((sla.breachAt.getTime() - new Date(sla.createdAt).getTime()) / 60_000)
                    : Math.max(0, Math.round((sla.breachAt.getTime() - Date.now()) / 60_000))
                )}
                highlight={sla.isBreached ? "text-red-600 dark:text-red-400" : undefined}
              />
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

/** Small dot indicator for tight surfaces (kanban headers, lists). */
export function SlaDot({ status }: { status: string }) {
  const color =
    status === SLA_STATUS.BREACH
      ? "bg-red-500"
      : status === SLA_STATUS.WARNING
      ? "bg-amber-500"
      : status === SLA_STATUS.TARGET
      ? "bg-emerald-500"
      : "bg-slate-400";
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", color)} aria-hidden />;
}

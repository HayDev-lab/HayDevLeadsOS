"use client";

// Compact SLA indicator for the Lead Detail header.
// Shows the live first-response SLA state, elapsed time and countdown
// (or the recorded first response time when answered). Same engine as badges.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Clock, AlertTriangle, CheckCircle2, Timer } from "lucide-react";
import { useLocale } from "@/lib/leados/locale";
import { useSlaTick } from "@/hooks/leados/use-sla-tick";
import { slaStatusLabel } from "./sla-badge";
import {
  DEFAULT_SLA_THRESHOLDS,
  SLA_STATUS,
  computeFirstResponseSla,
  humanizeDuration,
  humanizeHours,
  type SlaThresholds,
} from "@/lib/sla";

interface SlaDetailProps {
  createdAt: Date | string;
  firstResponseAt?: Date | string | null;
  thresholds?: SlaThresholds | null;
}

export function SlaDetail({ createdAt, firstResponseAt, thresholds }: SlaDetailProps) {
  const { t } = useLocale();
  useSlaTick();

  const sla = useMemo(
    () => computeFirstResponseSla({ createdAt, firstResponseAt: firstResponseAt ?? null }, thresholds ?? DEFAULT_SLA_THRESHOLDS),
    [createdAt, firstResponseAt, thresholds?.target, thresholds?.warning, thresholds?.breach]
  );

  const th = thresholds ?? DEFAULT_SLA_THRESHOLDS;

  const tone =
    sla.status === SLA_STATUS.BREACH
      ? "border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30"
      : sla.status === SLA_STATUS.WARNING
      ? sla.escalated
        ? "border-orange-200 bg-orange-50/70 dark:border-orange-900/60 dark:bg-orange-950/30"
        : "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30"
      : sla.status === SLA_STATUS.TARGET
      ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/25"
      : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50";

  const Icon =
    sla.status === SLA_STATUS.BREACH
      ? AlertTriangle
      : sla.status === SLA_STATUS.RESPONDED
      ? CheckCircle2
      : sla.status === SLA_STATUS.TARGET
      ? CheckCircle2
      : Clock;
  const iconColor =
    sla.status === SLA_STATUS.BREACH
      ? "text-red-600 dark:text-red-400"
      : sla.status === SLA_STATUS.WARNING
      ? sla.escalated
        ? "text-orange-600 dark:text-orange-400"
        : "text-amber-600 dark:text-amber-400"
      : sla.status === SLA_STATUS.TARGET
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-slate-500 dark:text-slate-400";

  // Main line + countdown
  let main: string;
  let countdown: string | null = null;
  const createdMs = new Date(sla.createdAt).getTime();
  if (sla.isResponded) {
    main = `${t("sla.first_response")}: ${humanizeDuration(sla.responseMinutes ?? 0)}`;
  } else {
    main = `${humanizeDuration(sla.elapsedMinutes)} ${t("sla.without_response")}`;
    const breachInMin = Math.round((sla.breachAt.getTime() - Date.now()) / 60_000);
    if (sla.isBreached) {
      countdown = `${t("sla.breached_by")} ${humanizeDuration(sla.elapsedMinutes - Math.round((sla.breachAt.getTime() - createdMs) / 60_000))}`;
    } else if (breachInMin > 0) {
      countdown = `${t("sla.breach_in")} ${humanizeDuration(breachInMin)}`;
    }
  }

  return (
    <div
      role="status"
      aria-label={`${t("sla.title")}: ${slaStatusLabel(sla.status, t)}`}
      className={cn("flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5", tone)}
    >
      <Icon className={cn("h-4 w-4 shrink-0", iconColor)} />
      <div className="min-w-0 leading-tight">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Timer className="h-3 w-3 text-muted-foreground" aria-hidden />
          SLA
          <span className={iconColor}>{slaStatusLabel(sla.status, t)}</span>
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {main}
          {countdown && <span className="mx-1 opacity-40">·</span>}
          {countdown && <span className={sla.isBreached ? "font-medium text-red-600 dark:text-red-400" : ""}>{countdown}</span>}
        </p>
      </div>
      <span className="ml-1 hidden shrink-0 text-[10px] text-muted-foreground tabular-nums sm:inline" title={t("sla.lead_age")}>
        {t("sla.lead_age")} {humanizeDuration(Math.round((Date.now() - createdMs) / 60_000))}
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-[10px] text-muted-foreground tabular-nums md:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{humanizeHours(th.target)}
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{humanizeHours(th.warning)}
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />{humanizeHours(th.breach)}
      </span>
    </div>
  );
}

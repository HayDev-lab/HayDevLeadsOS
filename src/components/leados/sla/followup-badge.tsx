"use client";

// Shared FOLLOW-UP SLA badge — used by the Lead List, Lead Detail header and
// Kanban cards, so every surface shows the SAME engine result (lib/sla-followup).
// Details are available via a click/keyboard popover (not hover-only).
// Visual model: Scheduled = neutral blue · Due soon = amber · Overdue = red ·
// text + color, never color-only (accessibility).

import { cn } from "@/lib/utils";
import { Bell, AlarmClock, CalendarCheck2, CheckCircle2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocale } from "@/lib/leados/locale";
import { useSlaTick } from "@/hooks/leados/use-sla-tick";
import {
  DEFAULT_FOLLOWUP_SLA_CONFIG,
  FOLLOWUP_SLA_STATUS,
  computeFollowUpSla,
  humanizeDuration,
  type FollowUpSlaConfig,
  type FollowUpSlaResult,
  type FollowUpTaskInput,
} from "@/lib/sla-followup";

const STATUS_STYLE: Record<string, { icon: typeof Bell; classes: string }> = {
  [FOLLOWUP_SLA_STATUS.SCHEDULED]: {
    icon: Bell,
    classes: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  },
  [FOLLOWUP_SLA_STATUS.DUE_SOON]: {
    icon: AlarmClock,
    classes: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  [FOLLOWUP_SLA_STATUS.OVERDUE]: {
    icon: AlarmClock,
    classes: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  },
  [FOLLOWUP_SLA_STATUS.COMPLETED]: {
    icon: CheckCircle2,
    classes: "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  [FOLLOWUP_SLA_STATUS.NOT_REQUIRED]: {
    icon: Bell,
    classes: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
};

export function followUpStatusLabel(status: string, t: (k: any) => string): string {
  switch (status) {
    case FOLLOWUP_SLA_STATUS.SCHEDULED:
      return t("followup.scheduled");
    case FOLLOWUP_SLA_STATUS.DUE_SOON:
      return t("followup.due_soon");
    case FOLLOWUP_SLA_STATUS.OVERDUE:
      return t("followup.overdue");
    case FOLLOWUP_SLA_STATUS.COMPLETED:
      return t("followup.completed");
    default:
      return t("followup.not_required");
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

/** Same-day → "Today · 16:00", next-day → "Tomorrow", else "Sep 21, 14:00". */
export function dueDayLabel(dueAt: Date | string, t: (k: any) => string): string {
  const due = new Date(dueAt);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  const time = due.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (dayDiff === 0) return `${t("followup.today")} · ${time}`;
  if (dayDiff === 1) return t("followup.tomorrow");
  return formatDateTime(due);
}

export interface FollowUpBadgeProps {
  leadStatus: string;
  firstResponseAt?: Date | string | null;
  task?: {
    id: string;
    title?: string | null;
    dueAt?: Date | string | null;
    createdAt?: Date | string | null;
  } | null;
  lastCompletedAt?: Date | string | null;
  config?: FollowUpSlaConfig | null;
  /** Compact variant for dense surfaces (kanban cards, header). */
  compact?: boolean;
  /** When true renders nothing for quiet states (kanban: only DUE_SOON/OVERDUE). */
  onlyUrgent?: boolean;
  className?: string;
}

export function FollowUpBadge({
  leadStatus,
  firstResponseAt,
  task,
  lastCompletedAt,
  config,
  compact,
  onlyUrgent,
  className,
}: FollowUpBadgeProps) {
  const { t } = useLocale();
  useSlaTick(); // one shared timer — re-renders badges as time passes

  // Recomputed LOCALLY with the single engine — statuses stay live between
  // refetches (config comes from Settings via the API response). The compute
  // is a handful of date comparisons — no memoization needed.
  const fu: FollowUpSlaResult = computeFollowUpSla(
    {
      leadStatus,
      firstResponseAt: firstResponseAt ?? null,
      openTask: (task as FollowUpTaskInput | null) ?? null,
      lastCompleted: lastCompletedAt ? { id: "done", completedAt: lastCompletedAt } : null,
    },
    config ?? DEFAULT_FOLLOWUP_SLA_CONFIG
  );

  const style = STATUS_STYLE[fu.status] ?? STATUS_STYLE[FOLLOWUP_SLA_STATUS.NOT_REQUIRED];
  const Icon = style.icon;
  const label = followUpStatusLabel(fu.status, t);

  // Text under the label: deadline day / remaining / overdue amount.
  const duration =
    fu.status === FOLLOWUP_SLA_STATUS.OVERDUE
      ? humanizeDuration(fu.overdueMinutes ?? 0)
      : fu.status === FOLLOWUP_SLA_STATUS.DUE_SOON
      ? humanizeDuration(fu.remainingMinutes ?? 0)
      : fu.status === FOLLOWUP_SLA_STATUS.SCHEDULED
      ? fu.dueAt
        ? dueDayLabel(fu.dueAt, t)
        : "—"
      : "";

  if (onlyUrgent && fu.status !== FOLLOWUP_SLA_STATUS.DUE_SOON && fu.status !== FOLLOWUP_SLA_STATUS.OVERDUE) {
    return null;
  }

  const badge = (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${t("followup.title")}: ${label}${duration ? ` ${duration}` : ""}`}
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
          <CalendarCheck2 className="h-3.5 w-3.5 text-muted-foreground" />
          {t("followup.title")}
        </p>
        <div className="space-y-1.5">
          {fu.hasOpenFollowUp ? (
            <>
              <Row label={t("followup.label")} value={label} />
              {fu.taskTitle && <Row label={t("common.next_action")} value={fu.taskTitle} />}
              {fu.dueAt && <Row label={t("followup.due_at")} value={formatDateTime(fu.dueAt)} />}
              {fu.status === FOLLOWUP_SLA_STATUS.OVERDUE ? (
                <Row
                  label={t("followup.overdue_by")}
                  value={humanizeDuration(fu.overdueMinutes ?? 0)}
                  highlight="text-red-600 dark:text-red-400"
                />
              ) : fu.status === FOLLOWUP_SLA_STATUS.DUE_SOON ? (
                <Row
                  label={t("followup.due_in")}
                  value={humanizeDuration(fu.remainingMinutes ?? 0)}
                  highlight="text-amber-600 dark:text-amber-400"
                />
              ) : null}
              {fu.scheduledAt && <Row label={t("followup.scheduled_at")} value={formatDateTime(fu.scheduledAt)} />}
            </>
          ) : fu.status === FOLLOWUP_SLA_STATUS.COMPLETED ? (
            <>
              <Row label={t("followup.label")} value={label} highlight="text-emerald-600 dark:text-emerald-400" />
              {fu.completedAt && <Row label={t("followup.completed_at")} value={formatDateTime(fu.completedAt)} />}
              <p className="pt-1 text-muted-foreground">{t("followup.completed_hint")}</p>
            </>
          ) : (
            <p className="text-muted-foreground">
              {fu.isResponded ? t("followup.no_open") : t("followup.needs_response")}
            </p>
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

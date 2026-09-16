"use client";

// FOLLOW-UP SLA card for the Lead Detail right panel.
// Shows the current cycle state + deadline countdown and hosts the actions:
// Schedule (when nothing open) · Complete · Reschedule · Cancel.
// Quick options: Standard (+defaultFollowUpHours) · Tomorrow · +3 days · +1 week · Custom.
// The schedule/reschedule dialog is touch-friendly (large targets, native
// datetime-local picker) and keyboard accessible.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Bell, AlarmClock, CheckCircle2, CalendarPlus, Check, CalendarClock, X, RotateCcw, Ban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/lib/leados/locale";
import { useSlaTick } from "@/hooks/leados/use-sla-tick";
import { useFollowUpAction, useScheduleFollowUp } from "@/hooks/leados/use-api";
import { toast } from "sonner";
import { followUpStatusLabel } from "./followup-badge";
import {
  DEFAULT_FOLLOWUP_SLA_CONFIG,
  FOLLOWUP_SLA_STATUS,
  computeFollowUpSla,
  followUpQuickDate,
  humanizeDuration,
  type FollowUpSlaConfig,
} from "@/lib/sla-followup";

const QUICK_OPTIONS = [
  { key: "standard", labelKey: "followup.quick.standard" },
  { key: "tomorrow", labelKey: "followup.quick.tomorrow" },
  { key: "3days", labelKey: "followup.quick.3days" },
  { key: "1week", labelKey: "followup.quick.1week" },
] as const;

interface FollowUpCardProps {
  leadId: string;
  leadStatus: string;
  firstResponseAt?: Date | string | null;
  task?: { id: string; title?: string | null; dueAt?: Date | string | null; createdAt?: Date | string | null } | null;
  lastCompletedAt?: Date | string | null;
  config?: FollowUpSlaConfig | null;
}

export function FollowUpCard({ leadId, leadStatus, firstResponseAt, task, lastCompletedAt, config }: FollowUpCardProps) {
  const { t } = useLocale();
  useSlaTick();
  const [dialogMode, setDialogMode] = useState<null | "schedule" | "reschedule">(null);

  const cfg = config ?? DEFAULT_FOLLOWUP_SLA_CONFIG;

  const fu = computeFollowUpSla(
    {
      leadStatus,
      firstResponseAt: firstResponseAt ?? null,
      openTask: task ?? null,
      lastCompleted: lastCompletedAt ? { id: "done", completedAt: lastCompletedAt } : null,
    },
    cfg
  );

  const canSchedule = leadStatus !== "WON" && leadStatus !== "LOST" && leadStatus !== "ARCHIVED";

  const tone =
    fu.status === FOLLOWUP_SLA_STATUS.OVERDUE
      ? "border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30"
      : fu.status === FOLLOWUP_SLA_STATUS.DUE_SOON
      ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30"
      : fu.status === FOLLOWUP_SLA_STATUS.SCHEDULED
      ? "border-sky-200 bg-sky-50/60 dark:border-sky-900/60 dark:bg-sky-950/25"
      : fu.status === FOLLOWUP_SLA_STATUS.COMPLETED
      ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/25"
      : "";

  const main =
    fu.status === FOLLOWUP_SLA_STATUS.OVERDUE
      ? `${t("followup.overdue_by")} ${humanizeDuration(fu.overdueMinutes ?? 0)}`
      : fu.status === FOLLOWUP_SLA_STATUS.DUE_SOON
      ? `${t("followup.due_in")} ${humanizeDuration(fu.remainingMinutes ?? 0)}`
      : fu.dueAt
      ? new Date(fu.dueAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : t("followup.no_open");

  return (
    <Card className={cn(tone)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {t("followup.label")}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <div role="status" aria-label={`${t("followup.title")}: ${followUpStatusLabel(fu.status, t)}`}>
          <p
            className={cn(
              "text-xs font-semibold",
              fu.status === FOLLOWUP_SLA_STATUS.OVERDUE && "text-red-600 dark:text-red-400",
              fu.status === FOLLOWUP_SLA_STATUS.DUE_SOON && "text-amber-600 dark:text-amber-400",
              fu.status === FOLLOWUP_SLA_STATUS.SCHEDULED && "text-sky-700 dark:text-sky-300",
              fu.status === FOLLOWUP_SLA_STATUS.COMPLETED && "text-emerald-600 dark:text-emerald-400",
              (fu.status === FOLLOWUP_SLA_STATUS.NOT_REQUIRED || !fu.hasOpenFollowUp) && "text-muted-foreground"
            )}
          >
            {fu.hasOpenFollowUp || fu.status === FOLLOWUP_SLA_STATUS.COMPLETED ? followUpStatusLabel(fu.status, t) : t("followup.not_required")}
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">{main}</p>
          {fu.status === FOLLOWUP_SLA_STATUS.COMPLETED && fu.completedAt && (
            <p className="text-[10px] text-muted-foreground">
              {t("followup.completed_at")}: {new Date(fu.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </p>
          )}
        </div>

        {/* actions */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {fu.hasOpenFollowUp ? (
            <>
              <CompleteButton leadId={leadId} taskId={fu.taskId} />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDialogMode("reschedule")}>
                <RotateCcw className="h-3 w-3 mr-1" />
                {t("followup.reschedule")}
              </Button>
              <CancelButton leadId={leadId} taskId={fu.taskId} />
            </>
          ) : canSchedule ? (
            fu.isResponded ? (
              <Button size="sm" className="h-7 text-xs" onClick={() => setDialogMode("schedule")}>
                <CalendarPlus className="h-3 w-3 mr-1" />
                {t("followup.schedule")}
              </Button>
            ) : (
              <p className="text-[10px] text-muted-foreground italic">{t("followup.needs_response")}</p>
            )
          ) : null}
        </div>
        {fu.status === FOLLOWUP_SLA_STATUS.COMPLETED && (
          <p className="text-[10px] text-muted-foreground">{t("followup.completed_hint")}</p>
        )}
      </CardContent>

      <FollowUpDialog
        leadId={leadId}
        mode={dialogMode}
        config={cfg}
        onOpenChange={(v) => !v && setDialogMode(null)}
      />
    </Card>
  );
}

function CompleteButton({ leadId, taskId }: { leadId: string; taskId: string | null }) {
  const { t } = useLocale();
  const action = useFollowUpAction(leadId);
  return (
    <Button
      size="sm"
      className="h-7 text-xs"
      disabled={action.isPending}
      onClick={async () => {
        try {
          await action.mutateAsync({ id: leadId, action: "complete" });
          toast.success(t("toast.followup_completed"));
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      <Check className="h-3 w-3 mr-1" />
      {t("followup.complete")}
    </Button>
  );
}

function CancelButton({ leadId, taskId }: { leadId: string; taskId: string | null }) {
  const { t } = useLocale();
  const action = useFollowUpAction(leadId);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-xs text-muted-foreground"
      disabled={action.isPending}
      title={t("followup.cancel")}
      onClick={async () => {
        try {
          await action.mutateAsync({ id: leadId, action: "cancel" });
          toast.success(t("toast.followup_cancelled"));
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      <Ban className="h-3 w-3 mr-1" />
      {t("followup.cancel")}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Schedule / Reschedule dialog — quick options + custom datetime + note.
// ---------------------------------------------------------------------------

function FollowUpDialog({
  leadId,
  mode,
  config,
  onOpenChange,
}: {
  leadId: string;
  mode: null | "schedule" | "reschedule";
  config: FollowUpSlaConfig;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useLocale();
  const schedule = useScheduleFollowUp(leadId);
  const action = useFollowUpAction(leadId);
  const [quick, setQuick] = useState<string>("standard");
  const [customDate, setCustomDate] = useState("");
  const [note, setNote] = useState("");
  const pending = schedule.isPending || action.isPending;

  const resolveDueAt = (): Date | null => {
    if (quick === "custom") {
      if (!customDate) return null;
      const d = new Date(customDate);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return followUpQuickDate(quick, config);
  };

  const submit = async () => {
    const dueAt = resolveDueAt();
    if (!dueAt) {
      toast.error(t("followup.quick.custom"));
      return;
    }
    try {
      if (mode === "schedule") {
        await schedule.mutateAsync({ id: leadId, dueAt: dueAt.toISOString(), note: note || undefined });
        toast.success(t("toast.followup_scheduled"));
      } else {
        await action.mutateAsync({ id: leadId, action: "reschedule", dueAt: dueAt.toISOString(), note: note || undefined });
        toast.success(t("toast.followup_rescheduled"));
      }
      onOpenChange(false);
      setNote("");
      setCustomDate("");
      setQuick("standard");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!mode) return null;

  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "schedule" ? <CalendarPlus className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
            {mode === "schedule" ? t("followup.schedule") : t("followup.reschedule")}
          </DialogTitle>
        </DialogHeader>

        {/* quick options — big touch-friendly buttons */}
        <div role="radiogroup" aria-label={t("followup.due_at")} className="grid grid-cols-2 gap-2 py-1">
          {QUICK_OPTIONS.map((opt) => {
            const preview =
              opt.key === "standard"
                ? humanizeDuration(config.defaultFollowUpHours * 60)
                : opt.key === "tomorrow"
                ? "+24h"
                : opt.key === "3days"
                ? "+72h"
                : "+168h";
            return (
              <button
                key={opt.key}
                role="radio"
                aria-checked={quick === opt.key}
                onClick={() => setQuick(opt.key)}
                className={cn(
                  "flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition min-h-[52px]",
                  quick === opt.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                )}
              >
                <span className="text-sm font-medium">{t(opt.labelKey)}</span>
                <span className={cn("text-[10px]", quick === opt.key ? "opacity-80" : "text-muted-foreground")}>{preview}</span>
              </button>
            );
          })}
          <button
            role="radio"
            aria-checked={quick === "custom"}
            onClick={() => setQuick("custom")}
            className={cn(
              "flex flex-col items-start justify-center rounded-lg border px-3 py-2.5 text-left transition min-h-[52px] col-span-2",
              quick === "custom" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
          >
            <span className="text-sm font-medium">{t("followup.quick.custom")}</span>
          </button>
        </div>

        {quick === "custom" && (
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="followup-due">{t("followup.due_at")}</Label>
            <Input
              id="followup-due"
              type="datetime-local"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="h-9"
            />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="followup-note">{t("followup.note")}</Label>
          <Textarea
            id="followup-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("followup.note")}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            <X className="h-3.5 w-3.5 mr-1" />{t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {mode === "schedule" ? <CalendarPlus className="h-3.5 w-3.5 mr-1" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
            {mode === "schedule" ? t("followup.schedule") : t("followup.reschedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

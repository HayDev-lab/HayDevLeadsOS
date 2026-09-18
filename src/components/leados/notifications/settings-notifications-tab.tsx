"use client";

// SETTINGS → NOTIFICATIONS tab (spec Sections 54–56, 86).
// - Per-user delivery preferences (event ≠ delivery preference, Section 99):
//   toggles per event type for the CURRENT session user.
// - One centralized task due-soon window (Section 53 — no per-task settings).
// - Dev-only domain event inspector (Section 86): type / entity / dedup key /
//   occurredAt — for QA, not a public admin product.

import { useEffect, useMemo, useState } from "react";
import { BellRing, Save, Mail, MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useLocale } from "@/lib/leados/locale";
import { api, useDomainEvents, useNotificationPreferences, useSaveNotificationPreferences, useSettings, useTelegramStatus, useIntegrationsStatus } from "@/hooks/leados/use-api";
import { EVENT_SEVERITY, DOMAIN_EVENT_TYPES, type DomainEventType } from "@/lib/domain-events";
import { severityMeta } from "./notification-card";
import type { DictKey } from "@/lib/leados/i18n";
import { cn } from "@/lib/utils";

const PREF_LABEL_KEYS: Record<DomainEventType, string> = {
  FIRST_RESPONSE_BREACHED: "notif.prefs.fr_breached",
  FOLLOW_UP_DUE_SOON: "notif.prefs.fu_due_soon",
  FOLLOW_UP_OVERDUE: "notif.prefs.fu_overdue",
  STAGE_AGING: "notif.prefs.stage_aging",
  STAGE_BECAME_STALE: "notif.prefs.stage_stale",
  LEAD_ASSIGNED: "notif.prefs.lead_assigned",
  TASK_ASSIGNED: "notif.prefs.task_assigned",
  TASK_DUE_SOON: "notif.prefs.task_due_soon",
  TASK_OVERDUE: "notif.prefs.task_overdue",
};

export function NotificationsTab() {
  const { t } = useLocale();
  const prefs = useNotificationPreferences();
  const savePrefs = useSaveNotificationPreferences();
  const settings = useSettings();
  const events = useDomainEvents(1, 30);
  const telegram = useTelegramStatus();
  const integrations = useIntegrationsStatus();

  const [toggles, setToggles] = useState<Record<string, boolean> | null>(null);
  // v0.16 (spec 38-40): per-event EXTERNAL channel matrix. Defaults OFF (98);
  // Telegram toggles are disabled until the user connects (spec 40).
  const [channels, setChannels] = useState<Record<string, { email: boolean; telegram: boolean }> | null>(null);
  const [taskWindow, setTaskWindow] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Initialize local state once preferences load (never overwrite user edits).
  useEffect(() => {
    if (prefs.data?.preferences && toggles === null) {
      setToggles({ ...prefs.data.preferences });
      setChannels((prefs.data.channels ?? {}) as Record<string, { email: boolean; telegram: boolean }>);
    }
  }, [prefs.data?.preferences, prefs.data?.channels, toggles]);

  const storedTaskWindow = useMemo(() => {
    const row = (settings.data?.settings ?? []).find(
      (s: { key: string; value?: unknown }) => s.key === "task_events"
    );
    const raw = row?.value;
    if (raw == null) return "4";
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      const hours = Number((parsed as { warningBeforeHours?: number }).warningBeforeHours);
      return Number.isFinite(hours) && hours > 0 ? String(hours) : "4";
    } catch {
      return "4";
    }
  }, [settings.data?.settings]);

  useEffect(() => {
    if (!taskWindow) setTaskWindow(storedTaskWindow);
  }, [storedTaskWindow, taskWindow]);

  const dirty =
    (toggles !== null &&
      channels !== null &&
      (prefs.data?.preferences
        ? DOMAIN_EVENT_TYPES.some(
            (type) =>
              toggles[type] !== prefs.data.preferences[type] ||
              (channels[type]?.email ?? false) !== (prefs.data.channels?.[type]?.email ?? false) ||
              (channels[type]?.telegram ?? false) !== (prefs.data.channels?.[type]?.telegram ?? false)
          )
        : false)) ||
    taskWindow !== storedTaskWindow;

  const emailMode = integrations.data?.channels.email.mode;
  const telegramMode = telegram.data?.mode ?? integrations.data?.channels.telegram.mode;
  const telegramConnected = telegram.data?.connected ?? false;

  const save = async () => {
    if (!toggles || !channels) return;
    const hours = Number(taskWindow);
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error(t("notif.settings.task_window"));
      return;
    }
    setSaving(true);
    try {
      await savePrefs.mutateAsync({ types: toggles, channels });
      await api.post("/settings", { key: "task_events", value: { warningBeforeHours: hours } });
      await Promise.all([prefs.refetch(), settings.refetch()]);
      toast.success(t("notif.settings.saved"));
    } catch {
      toast.error(t("toast.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  if (prefs.isLoading || !toggles) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4 text-primary" />
            {t("notif.settings.title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("notif.settings.subtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Channel availability hint (spec 40): Telegram disabled until connected. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
            <span className="font-medium">{t("notif.settings.channels")}:</span>
            <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {emailMode === "UNAVAILABLE" ? t("integr.mode.unavailable") : emailMode === "DEMO" ? t("integr.mode.demo") : t("integr.mode.real")}</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" /> {telegramConnected ? (telegramMode === "DEMO" ? t("integr.mode.demo") : t("integr.mode.real")) : t("integr.telegram.connect_first")}</span>
          </div>
          {DOMAIN_EVENT_TYPES.map((type) => {
            const meta = severityMeta(EVENT_SEVERITY[type]);
            const labelKey = PREF_LABEL_KEYS[type];
            const emailOn = channels?.[type]?.email ?? false;
            const telegramOn = channels?.[type]?.telegram ?? false;
            return (
              <div
                key={type}
                className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 rounded-lg border px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold",
                      meta.chipClass
                    )}
                  >
                    {t(`notif.severity.${EVENT_SEVERITY[type].toLowerCase()}` as DictKey).slice(0, 1)}
                  </span>
                  <span className="truncate text-sm">{t(labelKey as DictKey)}</span>
                </div>
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="flex items-center gap-1.5" title={t("notif.channel.in_app")}>
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">{t("notif.channel.in_app")}</span>
                    <Switch
                      checked={toggles[type] !== false}
                      onCheckedChange={(v) => setToggles((s) => ({ ...(s ?? {}), [type]: v }))}
                      aria-label={`${t(labelKey as DictKey)} — ${t("notif.channel.in_app")}`}
                    />
                  </div>
                  <div className="flex items-center gap-1.5" title={t("notif.channel.email")}>
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">{t("notif.channel.email")}</span>
                    <Switch
                      checked={emailOn}
                      disabled={emailMode === "UNAVAILABLE"}
                      onCheckedChange={(v) => setChannels((s) => ({ ...(s ?? {}), [type]: { email: v, telegram: s?.[type]?.telegram ?? false } }))}
                      aria-label={`${t(labelKey as DictKey)} — ${t("notif.channel.email")}`}
                    />
                  </div>
                  <div className="flex items-center gap-1.5" title={t("notif.channel.telegram")}>
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">{t("notif.channel.telegram")}</span>
                    <Switch
                      checked={telegramOn}
                      disabled={!telegramConnected}
                      onCheckedChange={(v) => setChannels((s) => ({ ...(s ?? {}), [type]: { email: s?.[type]?.email ?? false, telegram: v } }))}
                      aria-label={`${t(labelKey as DictKey)} — ${t("notif.channel.telegram")}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="grid gap-1.5 pt-2">
            <Label htmlFor="task-warning-window" className="text-xs">
              {t("notif.settings.task_window")}
            </Label>
            <Input
              id="task-warning-window"
              type="number"
              min="1"
              step="1"
              value={taskWindow}
              onChange={(e) => setTaskWindow(e.target.value)}
              className="max-w-40"
            />
            <p className="text-[11px] text-muted-foreground">{t("notif.settings.task_window_hint")}</p>
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={save} disabled={saving || !dirty || savePrefs.isPending} size="sm">
              <Save className="h-4 w-4" />
              {saving ? "…" : t("common.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* DEV-ONLY event inspector (Section 86) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">{t("notif.settings.events_log")}</CardTitle>
        </CardHeader>
        <CardContent>
          {events.isLoading && <Skeleton className="h-32 w-full" />}
          {events.data && events.data.rows.length === 0 && (
            <p className="text-xs text-muted-foreground">—</p>
          )}
          {events.data && events.data.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Type</th>
                    <th className="py-1.5 pr-3 font-medium">Entity</th>
                    <th className="py-1.5 pr-3 font-medium">Dedup key</th>
                    <th className="py-1.5 font-medium">Occurred</th>
                  </tr>
                </thead>
                <tbody>
                  {events.data.rows.map((e) => (
                    <tr key={e.id} className="border-b last:border-0 align-top">
                      <td className="py-1.5 pr-3">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {e.type}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[10px] text-muted-foreground">
                        {e.entityType}:{e.entityId.slice(-6)}
                      </td>
                      <td className="max-w-56 truncate py-1.5 pr-3 font-mono text-[10px] text-muted-foreground">
                        {e.deduplicationKey}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-muted-foreground">{new Date(e.occurredAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                total: {events.data.total}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

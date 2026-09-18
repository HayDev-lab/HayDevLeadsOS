"use client";

import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings, usePipeline } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Clock, Bell, Hourglass, Save } from "lucide-react";
import { toast } from "sonner";
import { SlaBadge } from "./sla/sla-badge";
import { FollowUpBadge } from "./sla/followup-badge";
import { StageHealthBadge } from "./sla/stage-health-badge";
import {
  DEFAULT_SLA_THRESHOLDS,
  humanizeHours,
  parseSlaThresholds,
  validateSlaThresholds,
  type SlaThresholds,
} from "@/lib/sla";
import {
  DEFAULT_FOLLOWUP_SLA_CONFIG,
  humanizeDuration,
  parseFollowUpConfig,
  validateFollowUpConfig,
  type FollowUpSlaConfig,
} from "@/lib/sla-followup";
import {
  DEFAULT_STAGE_INACTIVITY_HOURS,
  DEFAULT_WARNING_BEFORE_HOURS,
  parseStageInactivityConfig,
  validateStageInactivityConfig,
} from "@/lib/sla-stage-inactivity";

const SLA_SETTING_KEY = "sla_thresholds";
const FOLLOWUP_SETTING_KEY = "followup_sla";
const STAGE_INACTIVITY_SETTING_KEY = "stage_inactivity";

export function SlaConfigTab() {
  return (
    <div className="space-y-4">
      <FirstResponseCard />
      <FollowUpConfigCard />
      <StageInactivityConfigCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE INACTIVITY configuration (per-stage thresholds keyed by STAGE ID)
// ---------------------------------------------------------------------------

function StageInactivityConfigCard() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const settings = useSettings();
  const pipeline = usePipeline();
  const [warning, setWarning] = useState<number>(DEFAULT_WARNING_BEFORE_HOURS);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Real pipeline stages — Settings FOLLOWS the pipeline (Section 13): a new
  // stage appears here automatically until it gets its own threshold.
  const stages: { id: string; name: string; type: string; semanticCode?: string }[] =
    pipeline.data?.pipelines?.[0]?.stages ?? [];
  const openStages = stages.filter((s) => s.type === "open");
  const finalStages = stages.filter((s) => s.type !== "open");

  // Load the stored config (keyed by stage ID — survives renames, Section 42).
  useEffect(() => {
    const rows = (settings.data?.settings as { key: string; value: unknown }[] | undefined) ?? [];
    const row = rows.find((s) => s.key === STAGE_INACTIVITY_SETTING_KEY);
    const parsed = row?.value != null ? parseStageInactivityConfig(row.value) : null;
    if (parsed) {
      setWarning(parsed.warningBeforeHours);
      const map: Record<string, number> = {};
      for (const [id, entry] of Object.entries(parsed.stages)) map[id] = entry.thresholdHours;
      setThresholds(map);
    }
  }, [settings.data]);

  // Value for a stage (input state), defaulting to the shared fallback.
  const valueFor = (id: string) => thresholds[id] ?? DEFAULT_STAGE_INACTIVITY_HOURS;

  // CLIENT-SIDE VALIDATION — same rules as the server (Section 15/16).
  const validation = useMemo(
    () =>
      validateStageInactivityConfig({
        warningBeforeHours: warning,
        stages: Object.fromEntries(openStages.map((s) => [s.id, { thresholdHours: valueFor(s.id) }])),
      }),
    [warning, thresholds, openStages]
  );

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const value = {
        warningBeforeHours: warning,
        // Only stages with an explicit value — untouched ones keep the fallback
        // so a NEW stage still gets the default (Section 14).
        stages: Object.fromEntries(
          openStages
            .filter((s) => thresholds[s.id] != null)
            .map((s) => [s.id, { thresholdHours: thresholds[s.id] }])
        ),
      };
      const res = await fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: STAGE_INACTIVITY_SETTING_KEY, value }),
      });
      if (res.ok) {
        // v0.24 fix: was t("stage.settings.title") — showed the card TITLE as the
        // toast instead of a "saved" message.
        toast.success(t("toast.stage_config_saved"));
        // Thresholds changed → every stage health surface must recompute NOW.
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["settings"] }),
          qc.invalidateQueries({ queryKey: ["leads"] }),
          qc.invalidateQueries({ queryKey: ["lead"] }),
          qc.invalidateQueries({ queryKey: ["kanban"] }),
          qc.invalidateQueries({ queryKey: ["dashboard"] }),
        ]);
      } else {
        let msg = t("toast.save_failed");
        try {
          const body = await res.json();
          msg = body?.error ?? msg;
        } catch {}
        setServerError(msg);
        toast.error(msg);
      }
    } catch {
      toast.error(t("toast.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  if (settings.isLoading || pipeline.isLoading) return <Skeleton className="h-64 w-full" />;

  const now = Date.now();
  const effectiveThresholds = Object.fromEntries(openStages.map((s) => [s.id, valueFor(s.id)]));
  const previewConfig = { warningBeforeHours: warning, thresholds: effectiveThresholds };
  // §12: preview defaults to the PROPOSAL stage by SEMANTIC code — display
  // names are renamable/localizable and must not drive selection logic.
  const previewStage = openStages.find((s) => s.semanticCode === "PROPOSAL")?.id ?? openStages[0]?.id ?? "";
  const previewHours = effectiveThresholds[previewStage] ?? DEFAULT_STAGE_INACTIVITY_HOURS;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Hourglass className="h-4 w-4" />{t("stage.settings.title")}</CardTitle>
        <CardDescription className="text-xs">{t("stage.settings.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* global warning window */}
        <div className="max-w-xs space-y-1">
          <Label className="text-xs flex items-center gap-1.5" htmlFor="si-warning">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {t("stage.settings.warning_before")}
          </Label>
          <Input
            id="si-warning"
            type="number"
            min={1}
            max={168}
            step={1}
            value={Number.isNaN(warning) ? "" : warning}
            onChange={(e) => setWarning(e.target.value === "" ? NaN : Number(e.target.value))}
            aria-invalid={!validation.ok}
            className="h-8"
          />
          <p className="text-[10px] text-muted-foreground">{t("stage.aging")} · −{Number.isNaN(warning) ? "…" : humanizeDuration(warning * 60)}</p>
        </div>

        {/* per-stage thresholds — REAL pipeline stages, stacked rows (Section 97) */}
        <div className="space-y-1.5">
          {openStages.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{s.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {thresholds[s.id] == null ? t("stage.settings.using_default", { hours: DEFAULT_STAGE_INACTIVITY_HOURS }) : `${t("stage.stale_after")} ${humanizeHours(thresholds[s.id])}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Input
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  value={valueFor(s.id)}
                  onChange={(e) => {
                    const v = e.target.value === "" ? NaN : Number(e.target.value);
                    setThresholds((cur) => ({ ...cur, [s.id]: v }));
                  }}
                  aria-label={`${s.name} — ${t("stage.settings.stale_after")}`}
                  aria-invalid={!validation.ok}
                  className="h-8 w-20 text-right"
                />
                <span className="text-[10px] text-muted-foreground w-10">{t("stage.settings.hours")}</span>
              </div>
            </div>
          ))}
          {finalStages.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {finalStages.map((s) => s.name).join(" · ")} — {t("stage.settings.not_monitored")}
              </p>
            </div>
          )}
        </div>

        {/* inline validation errors (client) */}
        {!validation.ok && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2">
            <ul className="list-disc pl-4 text-xs text-red-700 dark:text-red-300 space-y-0.5">
              {validation.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}
        {serverError && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {serverError}
          </div>
        )}

        {/* Preview — the SAME StageHealthBadge used in the Lead List (Section 76). */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground mb-2">{t("stage.settings.preview")}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <StageHealthBadge
              leadStatus="OPEN"
              stageId={previewStage}
              stageName={openStages.find((s) => s.id === previewStage)?.name}
              stageType="open"
              stageEnteredAt={new Date(now - (previewHours - warning - 5) * 3_600_000)}
              createdAt={new Date(now - (previewHours - warning - 5) * 3_600_000)}
              config={previewConfig}
            />
            <StageHealthBadge
              leadStatus="OPEN"
              stageId={previewStage}
              stageName={openStages.find((s) => s.id === previewStage)?.name}
              stageType="open"
              stageEnteredAt={new Date(now - (previewHours - warning + 1) * 3_600_000)}
              createdAt={new Date(now - (previewHours - warning + 1) * 3_600_000)}
              config={previewConfig}
            />
            <StageHealthBadge
              leadStatus="OPEN"
              stageId={previewStage}
              stageName={openStages.find((s) => s.id === previewStage)?.name}
              stageType="open"
              stageEnteredAt={new Date(now - (previewHours + 2) * 3_600_000)}
              createdAt={new Date(now - (previewHours + 2) * 3_600_000)}
              config={previewConfig}
            />
          </div>
        </div>

        <Button size="sm" onClick={save} disabled={saving || !validation.ok}>
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FOLLOW-UP SLA configuration (independent thresholds, own Setting key)
// ---------------------------------------------------------------------------

function FollowUpConfigCard() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const settings = useSettings();
  const [config, setConfig] = useState<FollowUpSlaConfig>(DEFAULT_FOLLOWUP_SLA_CONFIG);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const rows = (settings.data?.settings as { key: string; value: unknown }[] | undefined) ?? [];
    const row = rows.find((s) => s.key === FOLLOWUP_SETTING_KEY);
    const parsed = row?.value != null ? parseFollowUpConfig(row.value) : null;
    setConfig(parsed ?? DEFAULT_FOLLOWUP_SLA_CONFIG);
  }, [settings.data]);

  // CLIENT-SIDE VALIDATION — same rules as the server.
  const validation = useMemo(() => validateFollowUpConfig(config), [config]);

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const res = await fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: FOLLOWUP_SETTING_KEY, value: validation.ok ? validation.config : config }),
      });
      if (res.ok) {
        // v0.24 fix: was t("followup.settings.title") — showed the card TITLE as
        // the toast instead of a "saved" message.
        toast.success(t("toast.followup_saved"));
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["settings"] }),
          qc.invalidateQueries({ queryKey: ["leads"] }),
          qc.invalidateQueries({ queryKey: ["lead"] }),
          qc.invalidateQueries({ queryKey: ["kanban"] }),
          qc.invalidateQueries({ queryKey: ["dashboard"] }),
        ]);
      } else {
        let msg = t("toast.save_failed");
        try {
          const body = await res.json();
          msg = body?.error ?? msg;
        } catch {}
        setServerError(msg);
        toast.error(msg);
      }
    } catch {
      toast.error(t("toast.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  if (settings.isLoading) return <Skeleton className="h-48 w-full" />;

  const num = (v: string) => (v === "" ? NaN : Number(v));
  const effective = validation.ok ? validation.config! : null;
  const now = Date.now();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Bell className="h-4 w-4" />{t("followup.settings.title")}</CardTitle>
        <CardDescription className="text-xs">{t("followup.settings.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5" htmlFor="fu-warning">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {t("followup.settings.warning_before")}
            </Label>
            <Input
              id="fu-warning"
              type="number"
              min={0.5}
              max={336}
              step={0.5}
              value={Number.isNaN(config.warningBeforeHours) ? "" : config.warningBeforeHours}
              onChange={(e) => setConfig((c) => ({ ...c, warningBeforeHours: num(e.target.value) }))}
              aria-invalid={!validation.ok}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">{t("followup.due_soon")} · {humanizeDuration((effective?.warningBeforeHours ?? config.warningBeforeHours) * 60)}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5" htmlFor="fu-default">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              {t("followup.settings.default_hours")}
            </Label>
            <Input
              id="fu-default"
              type="number"
              min={0.5}
              max={720}
              step={0.5}
              value={Number.isNaN(config.defaultFollowUpHours) ? "" : config.defaultFollowUpHours}
              onChange={(e) => setConfig((c) => ({ ...c, defaultFollowUpHours: num(e.target.value) }))}
              aria-invalid={!validation.ok}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">{t("followup.quick.standard")} · +{effective?.defaultFollowUpHours ?? config.defaultFollowUpHours}h</p>
          </div>
        </div>

        {/* auto-create policy — OFF by default */}
        <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
          <div className="space-y-0.5">
            <Label htmlFor="fu-auto" className="text-xs font-medium">{t("followup.settings.auto_create")}</Label>
            <p className="text-[10px] text-muted-foreground">{t("followup.settings.auto_create_hint")}</p>
          </div>
          <Switch
            id="fu-auto"
            checked={!!config.autoCreateAfterFirstResponse}
            onCheckedChange={(v) => setConfig((c) => ({ ...c, autoCreateAfterFirstResponse: v }))}
          />
        </div>

        {/* inline validation errors (client) */}
        {!validation.ok && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2">
            <ul className="list-disc pl-4 text-xs text-red-700 dark:text-red-300 space-y-0.5">
              {validation.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}
        {serverError && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {serverError}
          </div>
        )}

        {/* Preview — the SAME FollowUpBadge component used in the Lead List. */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground mb-2">{t("followup.settings.preview")}:</p>
          <div className="flex items-center gap-2 flex-wrap">
            <FollowUpBadge
              leadStatus="OPEN"
              firstResponseAt={new Date(now - 2 * 3_600_000)}
              task={{ id: "preview-sch", dueAt: new Date(now + 26 * 3_600_000) }}
              config={effective}
            />
            <FollowUpBadge
              leadStatus="OPEN"
              firstResponseAt={new Date(now - 2 * 3_600_000)}
              task={{ id: "preview-due", dueAt: new Date(now + 2 * 3_600_000) }}
              config={effective}
            />
            <FollowUpBadge
              leadStatus="OPEN"
              firstResponseAt={new Date(now - 2 * 3_600_000)}
              task={{ id: "preview-over", dueAt: new Date(now - 5 * 3_600_000) }}
              config={effective}
            />
            <FollowUpBadge
              leadStatus="OPEN"
              firstResponseAt={new Date(now - 2 * 3_600_000)}
              task={null}
              lastCompletedAt={new Date(now - 3 * 3_600_000)}
              config={effective}
            />
          </div>
        </div>

        <Button size="sm" onClick={save} disabled={saving || !validation.ok}>
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function FirstResponseCard() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const settings = useSettings();
  const [thresholds, setThresholds] = useState<SlaThresholds>(DEFAULT_SLA_THRESHOLDS);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Load from the Setting row (key "sla_thresholds", org-scoped).
  useEffect(() => {
    const rows = (settings.data?.settings as { key: string; value: unknown }[] | undefined) ?? [];
    const row = rows.find((s) => s.key === SLA_SETTING_KEY);
    const parsed = row?.value != null ? parseSlaThresholds(row.value) : null;
    setThresholds(parsed ?? DEFAULT_SLA_THRESHOLDS);
  }, [settings.data]);

  // CLIENT-SIDE VALIDATION — same rules as the server (validateSlaThresholds).
  // Server validation remains mandatory; this only enables inline UX.
  const validation = useMemo(() => validateSlaThresholds(thresholds), [thresholds]);

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const res = await fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: SLA_SETTING_KEY, value: thresholds }),
      });
      if (res.ok) {
        toast.success(t("toast.sla_saved"));
        // Thresholds changed → every SLA badge/sort/KPI must recompute NOW.
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["settings"] }),
          qc.invalidateQueries({ queryKey: ["leads"] }),
          qc.invalidateQueries({ queryKey: ["lead"] }),
          qc.invalidateQueries({ queryKey: ["kanban"] }),
          qc.invalidateQueries({ queryKey: ["dashboard"] }),
        ]);
      } else {
        let msg = t("toast.save_failed");
        try {
          const body = await res.json();
          msg = body?.error ?? msg;
        } catch {}
        setServerError(msg);
        toast.error(msg);
      }
    } catch {
      toast.error(t("toast.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  if (settings.isLoading) return <Skeleton className="h-48 w-full" />;

  const num = (v: string) => (v === "" ? NaN : Number(v));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" />{t("sla.settings.title")}</CardTitle>
        <CardDescription className="text-xs">
          {t("sla.settings.desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5" htmlFor="sla-target">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {t("sla.settings.target")}
            </Label>
            <Input
              id="sla-target"
              type="number"
              min={0}
              max={168}
              step="0.5"
              value={Number.isNaN(thresholds.target) ? "" : thresholds.target}
              onChange={(e) => setThresholds((t) => ({ ...t, target: num(e.target.value) }))}
              aria-invalid={!validation.ok}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">{t("sla.settings.target_hint")}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5" htmlFor="sla-warning">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {t("sla.settings.warning")}
            </Label>
            <Input
              id="sla-warning"
              type="number"
              min={0}
              max={336}
              step="0.5"
              value={Number.isNaN(thresholds.warning) ? "" : thresholds.warning}
              onChange={(e) => setThresholds((t) => ({ ...t, warning: num(e.target.value) }))}
              aria-invalid={!validation.ok}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">{t("sla.settings.warning_hint")}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5" htmlFor="sla-breach">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              {t("sla.settings.breach")}
            </Label>
            <Input
              id="sla-breach"
              type="number"
              min={0}
              max={720}
              step="0.5"
              value={Number.isNaN(thresholds.breach) ? "" : thresholds.breach}
              onChange={(e) => setThresholds((t) => ({ ...t, breach: num(e.target.value) }))}
              aria-invalid={!validation.ok}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">{t("sla.settings.breach_hint")}</p>
          </div>
        </div>

        {/* inline validation errors (client) */}
        {!validation.ok && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2">
            <ul className="list-disc pl-4 text-xs text-red-700 dark:text-red-300 space-y-0.5">
              {validation.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}
        {serverError && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {serverError}
          </div>
        )}

        {/* Preview — the SAME SlaBadge component used in the Lead List, so the
            preview can never diverge from production UI. */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground mb-2">
            {t("sla.settings.preview", { a: humanizeHours(thresholds.target), b: humanizeHours(thresholds.warning), c: humanizeHours(thresholds.breach) })}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <SlaBadge createdAt={new Date(Date.now() - 10 * 60_000)} thresholds={validation.ok ? thresholds : null} />
            <SlaBadge createdAt={new Date(Date.now() - 90 * 60_000)} thresholds={validation.ok ? thresholds : null} />
            <SlaBadge createdAt={new Date(Date.now() - 6 * 3_600_000)} thresholds={validation.ok ? thresholds : null} />
            <SlaBadge createdAt={new Date(Date.now() - (thresholds.breach + 3) * 3_600_000)} thresholds={validation.ok ? thresholds : null} />
            <SlaBadge
              createdAt={new Date(Date.now() - 5 * 3_600_000)}
              firstResponseAt={new Date(Date.now() - 5 * 3_600_000 + 43 * 60_000)}
              thresholds={validation.ok ? thresholds : null}
            />
          </div>
        </div>

        <Button size="sm" onClick={save} disabled={saving || !validation.ok}>
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {saving ? t("common.saving") : t("sla.settings.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

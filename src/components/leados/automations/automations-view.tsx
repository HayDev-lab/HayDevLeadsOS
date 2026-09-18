"use client";

// HAYDEV LEADOS — AUTOMATIONS VIEW (v0.15, spec 38–39, 99–101).
//
// Rule list (name / trigger / status / last run / success-failed metrics),
// template gallery ("Use template" — never auto-enabled, spec 49), execution
// history (spec 50) and the manual "Run now" worker trigger for demos.
// Mobile: everything stacks vertically (spec 104) — no horizontal canvas.

import { useState } from "react";
import { useLocale } from "@/lib/leados/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Zap, Plus, PlayCircle, Pencil, Trash2, Sparkles, Activity, CheckCircle2, XCircle, Loader2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { timeAgo } from "@/components/leados/primitives";
import {
  useAutomations,
  useAutomationExecutions,
  useUpdateAutomation,
  useDeleteAutomation,
  useRunWorkers,
  type AutomationRuleRow,
  type AutomationExecutionRow,
} from "@/hooks/leados/use-api";
import { AUTOMATION_TEMPLATES } from "@/lib/automation-templates";
import { RuleBuilderDialog, draftFromTemplate, draftFromRule, enumLabel, type BuilderDraft } from "./rule-builder";
import { ExecutionDetailDialog, DryRunDialog, ExecutionStatusBadge, skipReasonLabel } from "./execution-detail";

export function AutomationsView() {
  const { t } = useLocale();
  /** Typed t() only accepts literal keys — dynamic labels go through tr(). */
  const tr = (key: string): string => t(key as Parameters<typeof t>[0]);
  const automations = useAutomations();
  const executions = useAutomationExecutions({});
  const updateRule = useUpdateAutomation();
  const deleteRule = useDeleteAutomation();
  const runWorkers = useRunWorkers();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderRule, setBuilderRule] = useState<AutomationRuleRow | null>(null);
  const [builderDraft, setBuilderDraft] = useState<BuilderDraft | null>(null);
  const [testRule, setTestRule] = useState<AutomationRuleRow | null>(null);
  const [detailExecution, setDetailExecution] = useState<AutomationExecutionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRuleRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const filteredExecutions = useAutomationExecutions(statusFilter === "all" ? {} : { status: statusFilter });

  const canManage = automations.data?.canManage ?? false;
  const rules: AutomationRuleRow[] = automations.data?.rows ?? [];
  const summary = automations.data?.summary;
  const executionRows: AutomationExecutionRow[] = filteredExecutions.data?.rows ?? [];

  function openCreate() {
    setBuilderRule(null);
    setBuilderDraft(null);
    setBuilderOpen(true);
  }

  function openEdit(rule: AutomationRuleRow) {
    setBuilderRule(rule);
    setBuilderDraft(null);
    setBuilderOpen(true);
  }

  function openTemplate(tplId: string) {
    const tpl = AUTOMATION_TEMPLATES.find((x) => x.id === tplId);
    if (!tpl) return;
    // Templates are DRAFTS (spec 49): localized name/description + the
    // structured trigger/conditions/actions from the pure template module.
    setBuilderRule(null);
    setBuilderDraft(
      draftFromTemplate({
        name: tr(tpl.nameKey),
        description: tr(tpl.descriptionKey),
        triggerType: tpl.triggerType,
        conditions: tpl.conditions,
        actions: tpl.actions,
      })
    );
    setBuilderOpen(true);
  }

  async function handleToggle(rule: AutomationRuleRow, enabled: boolean) {
    try {
      await updateRule.mutateAsync({ id: rule.id, body: { enabled } });
    } catch (e) {
      toast.error((e as Error)?.message ?? t("common.error"));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteRule.mutateAsync(deleteTarget.id);
      toast.success(t("auto.rule_deleted"));
    } catch (e) {
      toast.error((e as Error)?.message ?? t("common.error"));
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleRunWorkers() {
    try {
      const res = await runWorkers.mutateAsync(undefined as never);
      const created = res?.result?.automations?.executionsCreated ?? 0;
      toast.success(`${t("auto.workers_ran")} (${created})`);
    } catch {
      toast.error(t("common.error"));
    }
  }

  const loading = automations.isLoading;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b bg-card/30">
        <div className="px-4 md:px-6 py-4 md:py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                {t("auto.title")}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">{t("auto.subtitle")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRunWorkers} disabled={runWorkers.isPending}>
                {runWorkers.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
                <span className="hidden sm:inline">{runWorkers.isPending ? t("auto.running") : t("auto.run_now")}</span>
              </Button>
              {canManage && (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  <span className="hidden sm:inline">{t("auto.create")}</span>
                  <span className="sm:hidden">{t("common.create")}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Summary chips (spec 99 — simple metrics only) */}
          {summary && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1">
                <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                {t("auto.summary_rules")}: <b>{summary.rules}</b>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                {t("auto.summary_active")}: <b>{summary.active}</b>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1">
                <Activity className="h-3.5 w-3.5 text-sky-500" />
                {t("auto.summary_runs_today")}: <b>{summary.runsToday}</b>
              </span>
              {summary.failedTotal > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900" role="status">
                  <XCircle className="h-3.5 w-3.5" />
                  {t("auto.summary_failed")}: <b>{summary.failedTotal}</b>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 space-y-6 max-w-5xl">
        {/* Rules */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> {t("common.loading")}
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Sparkles className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <h3 className="font-semibold">{t("auto.no_rules_title")}</h3>
            <p className="text-sm text-muted-foreground mt-1">{t("auto.no_rules_desc")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <article
                key={rule.id}
                className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm"
                aria-label={rule.name}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold truncate">{rule.name}</h3>
                      <Badge
                        variant="outline"
                        className={
                          rule.enabled
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900"
                            : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800"
                        }
                      >
                        {rule.enabled ? t("auto.status.active") : t("auto.status.paused")}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">v{rule.version}</span>
                    </div>
                    {rule.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{rule.description}</p>
                    )}
                    {/* WHEN → IF → THEN summary */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-semibold text-sky-600 dark:text-sky-300">
                        {t("auto.when")} {tr(`auto.trigger.${rule.triggerType}`)}
                      </span>
                      {conditionSummary(rule, tr) && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-600 dark:text-amber-300 max-w-full truncate">
                          {t("auto.if")} {conditionSummary(rule, tr)}
                        </span>
                      )}
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-600 dark:text-emerald-300">
                        {t("auto.then")} {(rule.actions ?? []).map((a) => tr(`auto.action.${a.type}`)).join(" + ")}
                      </span>
                    </div>
                    {/* Metrics (spec 39, 99) */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" /> {t("auto.runs")}: {rule.metrics.runs}</span>
                      <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> {rule.metrics.success}</span>
                      {rule.metrics.failed > 0 && (
                        <span className="inline-flex items-center gap-1"><XCircle className="h-3 w-3 text-red-500" /> {rule.metrics.failed}</span>
                      )}
                      <span>
                        {t("auto.last_run")}: {rule.metrics.lastRunAt ? timeAgo(rule.metrics.lastRunAt) : t("auto.never")}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setTestRule(rule)}>
                      <PlayCircle className="h-3.5 w-3.5 mr-1" /> {t("auto.test")}
                    </Button>
                    {canManage && (
                      <>
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openEdit(rule)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(v) => handleToggle(rule, v)}
                          aria-label={rule.enabled ? t("auto.status.active") : t("auto.status.paused")}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(rule)}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Templates (spec 45–49) */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("auto.templates_title")}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t("auto.templates_desc")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AUTOMATION_TEMPLATES.map((tpl) => (
              <div key={tpl.id} className="rounded-xl border bg-card p-4 flex flex-col gap-2">
                <h3 className="text-sm font-semibold leading-snug">{tr(tpl.nameKey)}</h3>
                <p className="text-[11px] text-muted-foreground flex-1">{tr(tpl.descriptionKey)}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs w-full"
                  onClick={() => openTemplate(tpl.id)}
                  disabled={!canManage}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> {t("auto.use_template")}
                </Button>
              </div>
            ))}
          </div>
          {!canManage && (
            <p className="text-[11px] text-muted-foreground">{t("auto.permission_denied")}</p>
          )}
        </section>

        {/* Execution history (spec 50) */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-primary" />
              {t("auto.history_title")}
            </h2>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs" aria-label={t("common.filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                <SelectItem value="SUCCESS">{t("auto.status.SUCCESS")}</SelectItem>
                <SelectItem value="SKIPPED">{t("auto.status.SKIPPED")}</SelectItem>
                <SelectItem value="FAILED">{t("auto.status.FAILED")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredExecutions.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> {t("common.loading")}
            </div>
          ) : executionRows.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("auto.empty_history")}
            </div>
          ) : (
            <div className="rounded-xl border divide-y overflow-hidden">
              {executionRows.map((ex) => (
                <button
                  key={ex.id}
                  className="w-full text-left p-3 hover:bg-accent/50 transition flex flex-wrap items-center gap-x-3 gap-y-1.5"
                  onClick={() => setDetailExecution(ex)}
                >
                  <ExecutionStatusBadge status={ex.status} />
                  <span className="text-sm font-medium truncate max-w-[220px]">{ex.ruleName}</span>
                  <span className="text-xs text-muted-foreground">
                    {tr(`auto.trigger.${ex.eventName}`)}
                  </span>
                  {ex.error && <span className="text-xs text-red-600 dark:text-red-400 truncate max-w-[200px]">{ex.error}</span>}
                  {ex.skipReason && !ex.error && (
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">{skipReasonLabel(ex.skipReason, tr)}</span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{timeAgo(ex.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Dialogs */}
      <RuleBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        rule={builderRule}
        initialDraft={builderDraft}
      />
      <DryRunDialog rule={testRule} onOpenChange={(v) => !v && setTestRule(null)} />
      <ExecutionDetailDialog
        execution={detailExecution}
        onOpenChange={(v) => !v && setDetailExecution(null)}
        canManage={canManage}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auto.confirm_delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("auto.confirm_delete_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Compact IF summary for a rule card: "priority = Բարձր · stage = Proposal". */
function conditionSummary(rule: AutomationRuleRow, t: (key: string) => string): string {
  const group = (rule.conditions ?? null) as
    | { all?: { field: string; operator: string; value?: unknown }[]; any?: { field: string; operator: string; value?: unknown }[] }
    | null;
  const items = group?.all ?? group?.any ?? [];
  if (!items.length) return "";
  const mode = group?.any ? " ∨" : " ∧";
  return (
    items
      .map((c) => {
        const fieldKey = c.field
          .replace("lead.", "lead_")
          .replace("event.payload.", "")
          .replace("event.", "event_")
          .replace("task.", "task_");
        const label = t(`auto.field.${fieldKey}`) === `auto.field.${fieldKey}` ? c.field : t(`auto.field.${fieldKey}`);
        const op = t(`auto.op.${c.operator}`) === `auto.op.${c.operator}` ? c.operator : t(`auto.op.${c.operator}`);
        // Localize enum values (HIGH → Բարձր / Высокий), keep ids/numbers as-is.
        const raw = c.value == null ? "" : Array.isArray(c.value) ? c.value : String(c.value);
        const value = Array.isArray(raw)
          ? raw.map((v) => enumLabel(String(v), t)).join(" • ")
          : /^[A-Z_]+$/.test(String(raw))
          ? enumLabel(String(raw), t)
          : String(raw);
        return `${label} ${op} ${value}`.trim();
      })
      .join(mode)
  );
}

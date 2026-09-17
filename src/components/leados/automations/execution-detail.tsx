"use client";

// HAYDEV LEADOS — AUTOMATION EXECUTION DETAIL + DRY RUN dialogs (v0.15).
//
// Execution detail (spec 51): event, conditions trace, actions, result,
// error (human message only — spec 52), duration. FAILED executions expose
// a manual Retry (spec 24, 26) for owners/admins.
// Dry run (spec 36–37): preview trigger / conditions / actions against a
// selected lead — creates NOTHING.

import { useState } from "react";
import { useLocale } from "@/lib/leados/locale";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, MinusCircle, AlertTriangle, PlayCircle, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { timeAgo } from "@/components/leados/primitives";
import { enumLabel } from "./rule-builder";
import {
  useLeads,
  useDryRunAutomation,
  useRetryAutomationExecution,
  type AutomationExecutionRow,
  type AutomationRuleRow,
} from "@/hooks/leados/use-api";

// ---------------------------------------------------------------------------
// Status badge — NEVER color-only (spec 106): the text is always present.
// ---------------------------------------------------------------------------

export function ExecutionStatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  /** dynamic-key wrapper (typed t only accepts literal DictKeys) */
  const tr = (key: string): string => t(key as Parameters<typeof t>[0]);
  const label = tr(`auto.status.${status}`);
  const styles: Record<string, string> = {
    SUCCESS: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900",
    FAILED: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-900",
    SKIPPED: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800",
    RUNNING: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-900",
    PENDING: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800",
  };
  const Icon =
    status === "SUCCESS" ? CheckCircle2 :
    status === "FAILED" ? XCircle :
    status === "SKIPPED" ? MinusCircle :
    status === "RUNNING" ? Loader2 : Info;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${styles[status] ?? styles.SKIPPED}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function skipReasonLabel(reason: string | null, t: (key: string) => string): string {
  if (!reason) return "";
  switch (reason) {
    case "CONDITIONS_NOT_MATCHED": return t("auto.skip.conditions");
    case "EVENT_NO_LONGER_ACTIONABLE": return t("auto.skip.actionability");
    case "AUTOMATION_DEPTH_EXCEEDED": return t("auto.skip.depth");
    default: return reason;
  }
}

function formatValue(v: unknown, t: (key: string) => string): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.map((x) => formatValue(x, t)).join(", ");
  if (typeof v === "boolean") return v ? "✓" : "✗";
  const s = String(v);
  const l = enumLabel(s, t);
  return l;
}

// ---------------------------------------------------------------------------
// Execution detail dialog (spec 51)
// ---------------------------------------------------------------------------

export function ExecutionDetailDialog({
  execution,
  onOpenChange,
  canManage,
}: {
  execution: AutomationExecutionRow | null;
  onOpenChange: (v: boolean) => void;
  canManage: boolean;
}) {
  const { t } = useLocale();
  const tr = (key: string): string => t(key as Parameters<typeof t>[0]);
  const retry = useRetryAutomationExecution();
  const [retrying, setRetrying] = useState(false);

  if (!execution) return null;
  const result = execution.result ?? {};
  const conditions = result.conditions ?? [];
  const actions = result.actions ?? [];

  async function handleRetry() {
    if (!execution) return;
    setRetrying(true);
    try {
      await retry.mutateAsync(execution.id);
      toast.success(t("auto.rule_saved"));
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error)?.message ?? "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Dialog open={!!execution} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            {t("auto.execution_detail")}
            <ExecutionStatusBadge status={execution.status} />
          </DialogTitle>
          <DialogDescription className="text-xs">
            {execution.ruleName} · v{execution.ruleVersion} · {t("auto.last_run")}: {timeAgo(execution.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-4 space-y-4 text-sm">
            {/* Event */}
            <section className="space-y-1">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("auto.execution.event")}</h4>
              <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{tr(`auto.trigger.${execution.eventName}`)}</Badge>
                  {result.trigger?.occurredAt && (
                    <span className="text-muted-foreground">{new Date(result.trigger.occurredAt).toLocaleString()}</span>
                  )}
                </div>
                {execution.skipReason && (
                  <p className="text-muted-foreground">
                    {skipReasonLabel(execution.skipReason, tr)}
                    {result.notActionableBecause ? ` (${result.notActionableBecause})` : ""}
                  </p>
                )}
              </div>
            </section>

            {/* Conditions trace (spec 53) */}
            {conditions.length > 0 && (
              <section className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("auto.execution.conditions")}
                </h4>
                <div className="rounded-md border divide-y text-xs">
                  {conditions.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 p-2">
                      {c.passed ? (
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0 break-words">
                        <span className="font-medium">{tr(`auto.field.${c.field.replace("lead.", "lead_").replace("event.payload.", "").replace("event.", "event_").replace("task.", "task_")}`)}</span>
                        {" "}
                        <span className="text-muted-foreground">{tr(`auto.op.${c.operator}`)}</span>
                        {" "}
                        <span className="font-mono">{formatValue(c.expected, tr)}</span>
                        {" · "}
                        <span className="text-muted-foreground">→ {formatValue(c.actual, tr)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Actions (spec 97: partial completion clearly visible) */}
            {actions.length > 0 && (
              <section className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("auto.execution.actions")}</h4>
                <div className="rounded-md border divide-y text-xs">
                  {actions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 p-2">
                      {a.status === "SUCCESS" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-500 shrink-0" />
                      ) : a.status === "FAILED" ? (
                        <XCircle className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
                      ) : (
                        <MinusCircle className="h-3.5 w-3.5 mt-0.5 text-slate-400 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{i + 1}. {tr(`auto.action.${a.type}`)}</span>
                        <span className="text-muted-foreground"> — {a.status}</span>
                        {/* v0.16 (spec 19): effect trace — REUSED proves idempotency. */}
                        {a.effect && a.effect !== "NO_CHANGE" && (
                          <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px]">{tr(`auto.exec.effect.${a.effect}`)}</Badge>
                        )}
                        {/* v0.16 (spec 68): localized error codes — never stack traces. */}
                        {a.errorCode && (
                          <p className="text-red-600 dark:text-red-400 mt-0.5">
                            {tr(`errors.${a.errorCode}`) !== `errors.${a.errorCode}` ? tr(`errors.${a.errorCode}`) : (a.error ?? a.errorCode)}
                          </p>
                        )}
                        {!a.errorCode && a.error && <p className="text-red-600 dark:text-red-400 mt-0.5">{a.error}</p>}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Error + duration */}
            {(execution.error || execution.errorCode || result.durationMs != null) && (
              <section className="space-y-1.5">
                {(execution.error || execution.errorCode) && (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900" role="alert">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      {execution.errorCode && tr(`errors.${execution.errorCode}`) !== `errors.${execution.errorCode}`
                        ? tr(`errors.${execution.errorCode}`)
                        : (execution.error ?? execution.errorCode)}
                    </span>
                  </div>
                )}
                {result.durationMs != null && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("auto.execution.duration")}: {result.durationMs} ms
                  </p>
                )}
                {typeof result.chainDepth === "number" && result.chainDepth > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("auto.execution.depth")}: {result.chainDepth}
                  </p>
                )}
              </section>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
          {execution.status === "FAILED" && canManage && (
            <Button onClick={handleRetry} disabled={retrying} variant="default" size="sm">
              {retrying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
              {retrying ? t("auto.execution.retrying") : t("auto.execution.retry")}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dry run dialog (spec 36–37) — NOTHING is created
// ---------------------------------------------------------------------------

interface DryRunOutcome {
  triggerMatched: boolean;
  conditionsMatched: boolean;
  conditions: { field: string; operator: string; expected: unknown; actual: unknown; passed: boolean }[];
  conditionMode: string;
  actions: { type: string; status: string; summary: string }[];
  actionabilityNote: string | null;
  leadName: string | null;
}

export function DryRunDialog({
  rule,
  onOpenChange,
}: {
  rule: AutomationRuleRow | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useLocale();
  const tr = (key: string): string => t(key as Parameters<typeof t>[0]);
  const leads = useLeads({ limit: 50, sort: "recent" });
  const dryRun = useDryRunAutomation();
  const [leadId, setLeadId] = useState<string>("");
  const [outcome, setOutcome] = useState<DryRunOutcome | null>(null);

  if (!rule) return null;
  const leadRows = ((leads.data?.rows ?? []) as { id: string; firstName: string | null; lastName: string | null; company: string | null }[]);

  async function handleRun() {
    if (!rule) return;
    try {
      const res = await dryRun.mutateAsync({ id: rule.id, leadId: leadId || null });
      setOutcome(res.result as DryRunOutcome);
    } catch (e) {
      toast.error((e as Error)?.message ?? "Dry run failed");
    }
  }

  return (
    <Dialog open={!!rule} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <PlayCircle className="h-4 w-4 text-primary" />
            {t("auto.dry_run")} — {rule.name}
          </DialogTitle>
          <DialogDescription className="text-xs">{t("auto.dry_run_note")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("auto.dry_run_pick")}</label>
              <Select value={leadId} onValueChange={(v) => setLeadId(v)}>
                <SelectTrigger className="w-full text-sm" aria-label={t("auto.dry_run_pick")}>
                  <SelectValue placeholder={t("auto.dry_run_pick")} />
                </SelectTrigger>
                <SelectContent>
                  {leadRows.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {[l.firstName, l.lastName].filter(Boolean).join(" ") || l.company || l.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleRun} disabled={dryRun.isPending} className="w-full">
              {dryRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              {t("auto.dry_run_run")}
            </Button>

            {outcome && (
              <div className="space-y-3 pt-1" aria-live="polite">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">{t("auto.trigger_match")}:</span>
                  {outcome.triggerMatched ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900">MATCH</Badge>
                  ) : (
                    <Badge variant="outline">—</Badge>
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">{t("auto.if")}:</span>
                  {outcome.conditionsMatched ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900">{t("auto.conditions_pass")}</Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900">{t("auto.conditions_fail")}</Badge>
                  )}
                </div>

                {outcome.conditions.length > 0 && (
                  <div className="rounded-md border divide-y text-xs">
                    {outcome.conditions.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 p-2">
                        {c.passed ? (
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
                        )}
                        <span className="break-words">
                          <span className="font-medium">{c.field}</span>{" "}
                          <span className="text-muted-foreground">{c.operator}</span>{" "}
                          <span className="font-mono">{formatValue(c.expected, tr)}</span>
                          {" · → "}{formatValue(c.actual, tr)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("auto.actions_preview")}</h4>
                  <ol className="rounded-md border divide-y text-xs">
                    {outcome.actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 p-2">
                        <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{i + 1}</span>
                        <span className="break-words">
                          <span className="font-medium">{tr(`auto.action.${a.type}`)}</span>
                          {a.summary ? <span className="text-muted-foreground"> — {a.summary}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>

                {outcome.actionabilityNote && (
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {outcome.actionabilityNote}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

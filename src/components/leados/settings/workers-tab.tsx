"use client";

// SETTINGS → WORKERS (v0.16 spec 30–31, 71, 86).
// A compact admin block — NOT a DevOps dashboard:
//   • Scheduler state (on/off, interval) + proof the workers run server-side;
//   • Last runs: status (SUCCESS/PARTIAL/FAILED/RUNNING), trigger, duration,
//     events/automations/deliveries counts;
//   • Queue depth: pending/retry/failed deliveries, failed/retry automations;
//   • FAILED JOBS (spec 71): failed automations + failed deliveries with a
//     manual Retry (spec 63) — kept apart from lead "Attention".
// Technical errorCode details are visible to OWNER/ADMIN only (spec 62).

import { useState } from "react";
import { Activity, RefreshCw, RotateCcw, ServerCog, AlertOctagon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useLocale } from "@/lib/leados/locale";
import { useWorkersHealth, useDeliveries, useRetryDelivery, useRunWorkers, useAutomationExecutions, type DeliveryRow } from "@/hooks/leados/use-api";
import type { DictKey } from "@/lib/leados/i18n";
import { timeAgo } from "../primitives";

function statusBadgeClass(status: string): string {
  switch (status) {
    case "SUCCESS":
    case "SENT":
      return "border-emerald-300 text-emerald-700 dark:text-emerald-300";
    case "PARTIAL":
    case "FAILED_RETRYABLE":
      return "border-amber-300 text-amber-700 dark:text-amber-300";
    case "FAILED":
      return "border-red-300 text-red-700 dark:text-red-300";
    case "RUNNING":
    case "SENDING":
    case "PENDING":
      return "border-sky-300 text-sky-700 dark:text-sky-300";
    default:
      return "text-muted-foreground";
  }
}

export function WorkersTab() {
  const { t } = useLocale();
  const health = useWorkersHealth();
  const failedDeliveries = useDeliveries("FAILED");
  const retryableDeliveries = useDeliveries("FAILED_RETRYABLE");
  const skippedDeliveries = useDeliveries("SKIPPED");
  const executions = useAutomationExecutions({ status: "FAILED" });
  const retryDelivery = useRetryDelivery();
  const runWorkers = useRunWorkers();
  const [deliveryFilter, setDeliveryFilter] = useState("FAILED");

  if (health.isLoading) return <Skeleton className="h-96 w-full" />;
  const h = health.data;

  const deliveryRows: DeliveryRow[] =
    deliveryFilter === "FAILED_RETRYABLE" ? (retryableDeliveries.data?.rows ?? []) :
    deliveryFilter === "SKIPPED" ? (skippedDeliveries.data?.rows ?? []) :
    (failedDeliveries.data?.rows ?? []);

  const failedExecutions = (executions.data?.rows ?? []).filter(
    (e: { status: string }) => e.status === "FAILED" || e.status === "FAILED_RETRYABLE"
  );

  return (
    <div className="space-y-4 max-w-4xl">
      {/* SCHEDULER + QUEUE */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base"><ServerCog className="h-4 w-4" /> {t("workers.scheduler")}</CardTitle>
            <Button size="sm" variant="outline" onClick={() => runWorkers.mutate(undefined, { onSuccess: () => toast.success(t("workers.run_now_ok")) })} disabled={runWorkers.isPending}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${runWorkers.isPending ? "animate-spin" : ""}`} /> {t("workers.run_now")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <span className={h?.scheduler.enabled ? "text-emerald-500" : "text-muted-foreground"}>●</span>
              {h?.scheduler.enabled ? t("workers.scheduler_on", { sec: Math.round((h.scheduler.intervalMs ?? 300000) / 1000) }) : t("workers.scheduler_off")}
            </p>
            <p className="text-xs text-muted-foreground">{t("workers.scheduler_hint")}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {h?.leases.workers.active && <Badge variant="outline" className="status-badge">{t("workers.lease_active")}</Badge>}
              {h?.leases.delivery.active && <Badge variant="outline">{t("workers.lease_delivery_active")}</Badge>}
              {h?.staleRunningRuns ? <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-300">{t("workers.stale_runs", { n: h.staleRunningRuns })}</Badge> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> {t("workers.queue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border p-2">
                <p className="text-[11px] text-muted-foreground">{t("workers.queue.pending_deliveries")}</p>
                <p className="text-lg font-semibold">{h?.queue.pendingDeliveries ?? 0}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-[11px] text-muted-foreground">{t("workers.queue.retry_deliveries")}</p>
                <p className="text-lg font-semibold">{h?.queue.retryDeliveries ?? 0}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-[11px] text-muted-foreground">{t("workers.queue.failed_deliveries")}</p>
                <p className="text-lg font-semibold">{h?.queue.failedDeliveries ?? 0}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-[11px] text-muted-foreground">{t("workers.queue.failed_automations")}</p>
                <p className="text-lg font-semibold">{h?.queue.failedAutomations ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* LAST RUNS */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("workers.last_runs")}</CardTitle>
        </CardHeader>
        <CardContent>
          {(h?.runs ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("workers.no_runs")}</p>
          ) : (
            <div className="space-y-1.5">
              {(h?.runs ?? []).map((run) => {
                const stats = (run.stats ?? {}) as Record<string, number | string | string[]>;
                const duration = run.finishedAt
                  ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
                  : null;
                return (
                  <div key={run.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
                    <Badge variant="outline" className={statusBadgeClass(run.status)}>{run.status}</Badge>
                    <span className="text-muted-foreground">{run.type === "LEADOS_WORKERS" ? t("workers.type.workers") : t("workers.type.delivery")}</span>
                    <span className="text-muted-foreground">· {run.trigger ?? "—"}</span>
                    <span className="text-muted-foreground">· {timeAgo(run.startedAt)}</span>
                    {duration != null && <span className="text-muted-foreground">· {t("workers.duration", { ms: duration })}</span>}
                    {typeof stats.executionsCreated === "number" && stats.executionsCreated > 0 && (
                      <span>· {t("workers.run.executions", { n: stats.executionsCreated })}</span>
                    )}
                    {typeof stats.deliveriesSent === "number" && stats.deliveriesSent > 0 && (
                      <span>· {t("workers.run.deliveries", { n: stats.deliveriesSent })}</span>
                    )}
                    {Array.isArray(stats.stepErrors) && stats.stepErrors.length > 0 && (
                      <span className="text-amber-600 dark:text-amber-300">· {t("workers.run.step_errors", { n: stats.stepErrors.length })}</span>
                    )}
                    {run.error === "LEASE_BUSY" && <span className="text-muted-foreground">· {t("workers.lease_busy")}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* FAILED JOBS (spec 71) */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base"><AlertOctagon className="h-4 w-4 text-red-500" /> {t("workers.failed_automations")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {failedExecutions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("workers.no_failed")}</p>
            ) : (
              failedExecutions.slice(0, 8).map((e: { id: string; ruleName?: string; error?: string | null; errorCode?: string | null; status: string; createdAt?: string }) => (
                <div key={e.id} className="rounded-md border px-2.5 py-2 text-xs space-y-0.5">
                  <p className="font-medium truncate">{e.ruleName ?? e.id}</p>
                  <p className="text-muted-foreground truncate">
                    {e.errorCode ? t(`errors.${e.errorCode}` as DictKey) !== `errors.${e.errorCode}` ? t(`errors.${e.errorCode}` as DictKey) : (e.error ?? "—") : (e.error ?? "—")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{e.status} · {timeAgo(e.createdAt ?? "")}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base"><AlertOctagon className="h-4 w-4 text-red-500" /> {t("workers.failed_deliveries")}</CardTitle>
            <Select value={deliveryFilter} onValueChange={setDeliveryFilter}>
              <SelectTrigger className="h-7 w-[150px] text-xs" aria-label={t("common.filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FAILED">{t("delivery.status.FAILED")}</SelectItem>
                <SelectItem value="FAILED_RETRYABLE">{t("delivery.status.FAILED_RETRYABLE")}</SelectItem>
                <SelectItem value="SKIPPED">{t("delivery.status.SKIPPED")}</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {deliveryRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("workers.no_failed")}</p>
            ) : (
              deliveryRows.slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium">
                      {t(`delivery.channel.${d.channel}` as DictKey)}
                      {d.errorCode ? ` · ${t(`errors.${d.errorCode}` as DictKey) !== `errors.${d.errorCode}` ? t(`errors.${d.errorCode}` as DictKey) : d.errorCode}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{d.errorMessage ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(d.createdAt)}{d.attemptCount ? ` · ${t("workers.attempts", { n: d.attemptCount })}` : ""}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await retryDelivery.mutateAsync(d.id);
                        toast.success(t("workers.retry_queued"));
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                    disabled={retryDelivery.isPending}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> {t("common.retry")}
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

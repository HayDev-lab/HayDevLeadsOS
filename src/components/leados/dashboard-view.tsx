"use client";

import { useDashboard, useLostDetector, useRunLostDetector, useSession, useAnalytics } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { localizeStageName } from "@/lib/leados/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, ArrowUpRight, Bell, CalendarClock, CheckCircle2, ClipboardList, GaugeCircle, Hourglass, Inbox, Layers, Plus, Sparkles, Timer, TrendingUp, Trophy, XCircle, Zap } from "lucide-react";
import { MiniBar, OwnerChip, ScoreBadge, SourceBadge, StageBadge, timeAgo, EmptyState, formatMoney } from "./primitives";
import { useHashRoute } from "@/lib/leados/hash-route";
import { LeadFormDialog } from "./lead-form-dialog";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

export function DashboardView() {
  const { t, locale } = useLocale();
  const dash = useDashboard();
  const lost = useLostDetector();
  const run = useRunLostDetector();
  const session = useSession();
  const analytics = useAnalytics();
  const [, navigate] = useHashRoute();

  const m = dash.data?.metrics;
  const currency = session.data?.session?.organization?.currency ?? "AMD";
  const forecast = analytics.data?.forecast;

  const metricCards: { key: string; value: number; icon: typeof Sparkles; label: string; color: string; critical?: boolean; view: string; params?: Record<string, string> }[] = [
    { key: "new", value: m?.newLeads ?? 0, icon: Sparkles, label: t("metric.new_leads"), color: "text-sky-600 bg-sky-50 dark:bg-sky-950/40", view: "leads" },
    { key: "slaBreached", value: m?.slaBreached ?? 0, icon: Hourglass, label: t("sla.breached_leads"), color: "text-red-600 bg-red-50 dark:bg-red-950/40", critical: true, view: "leads", params: { sla: "BREACH" } },
    { key: "overdue", value: m?.overdueFollowups ?? 0, icon: Timer, label: t("followup.queue.overdue"), color: "text-red-600 bg-red-50 dark:bg-red-950/40", critical: true, view: "leads", params: { followUp: "OVERDUE" } },
    { key: "staleDeals", value: m?.staleDeals ?? 0, icon: Hourglass, label: t("stage.stale_deals"), color: "text-orange-600 bg-orange-50 dark:bg-orange-950/40", critical: true, view: "leads", params: { stageHealth: "STALE" } },
    { key: "unassigned", value: m?.unassigned ?? 0, icon: Inbox, label: t("metric.unassigned"), color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40", view: "leads" },
    { key: "qualified", value: m?.qualified ?? 0, icon: CheckCircle2, label: t("metric.qualified"), color: "text-violet-600 bg-violet-50 dark:bg-violet-950/40", view: "pipeline" },
    { key: "meetings", value: m?.meetings ?? 0, icon: CalendarClock, label: t("metric.meetings"), color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40", view: "pipeline" },
    { key: "proposals", value: m?.proposals ?? 0, icon: ClipboardList, label: t("metric.proposals"), color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40", view: "pipeline" },
    { key: "won", value: m?.won ?? 0, icon: Trophy, label: t("metric.won"), color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40", view: "pipeline" },
    { key: "lost", value: m?.lost ?? 0, icon: XCircle, label: t("metric.lost"), color: "text-rose-600 bg-rose-50 dark:bg-rose-950/40", view: "pipeline" },
  ];

  const totalActive = m?.totalActive ?? 0;
  const bySource = dash.data?.bySource ?? [];
  const sourceMax = Math.max(1, ...bySource.map((s) => s.count));
  const byStage = dash.data?.byStage ?? [];
  const stageMax = Math.max(1, ...byStage.map((s) => s.count));

  return (
    <div className="px-4 md:px-6 py-5 space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            {lost.data ? `${t("lost.detector.title")} · ${lost.data.leadsNeedingAttention}` : t("lost.detector.title")}
          </Button>
          <LeadFormDialog>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              {t("leads.new")}
            </Button>
          </LeadFormDialog>
        </div>
      </div>

      {/* attention banner */}
      {(lost.data?.leadsNeedingAttention ?? 0) > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Card className="border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-900">
            <CardContent className="py-3 flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 dark:bg-amber-900 p-2 leados-pulse">
                <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" />
              </div>
              <div className="flex-1 text-sm">
                <span className="font-semibold">{lost.data?.leadsNeedingAttention} {t("lost.needs_attention")}</span>
                <span className="text-muted-foreground ml-2">— {t("lost.detector.title")}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("leads")}>
                {t("common.actions")} <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-3">
        {metricCards.map((c, i) => (
          <motion.button
            key={c.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.22 }}
            onClick={() => navigate(c.view, c.params)}
            className={cn(
              "text-left rounded-xl border bg-card p-3 transition hover:shadow-sm hover:border-primary/30 leados-lift",
              c.critical && c.value > 0 && "border-red-300/60 dark:border-red-900"
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn("inline-flex items-center justify-center rounded-lg h-8 w-8", c.color)}>
                <c.icon className="h-4 w-4" />
              </span>
              {c.critical && c.value > 0 && <span className="h-2 w-2 rounded-full bg-red-500 leados-pulse" />}
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{dash.isLoading ? "…" : c.value}</div>
            {/* v0.21: labels wrap to 2 lines (was truncate — Armenian labels
                like "SLA-ի խախտումներ" were unreadable at 10-column density);
                fixed min-height keeps all cards in a row equal-height. */}
            <div className="text-[11px] leading-tight text-muted-foreground line-clamp-2 min-h-[2.4em]" title={c.label}>{c.label}</div>
          </motion.button>
        ))}
      </div>

      {/* NEEDS ATTENTION (Sections 65/112/113) — three INDEPENDENT engines,
          one presentation layer. Issues ≠ leads: one lead may carry 2-3 problems. */}
      {(dash.data?.slaAttention?.counts?.totalIssues ?? 0) > 0 && (
        <Card className="border-red-200/70 dark:border-red-900/60 bg-red-50/30 dark:bg-red-950/20">
          <CardContent className="py-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("attention.needs_attention")}
                <span className="text-muted-foreground font-normal normal-case">
                  {t("attention.issues_across", {
                    issues: dash.data!.slaAttention.counts.totalIssues,
                    leads: dash.data!.slaAttention.counts.leadsWithIssues,
                  })}
                </span>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                onClick={() => navigate("leads", { sla: "BREACH" })}
                className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left hover:bg-accent/60 transition"
              >
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Hourglass className="h-3.5 w-3.5 text-red-500" />
                  {t("attention.unanswered_leads")}
                </span>
                <span className={cn("text-lg font-bold tabular-nums", (dash.data?.slaAttention.counts.firstResponseBreached ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                  {dash.data?.slaAttention.counts.firstResponseBreached ?? 0}
                </span>
              </button>
              <button
                onClick={() => navigate("leads", { followUp: "OVERDUE" })}
                className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left hover:bg-accent/60 transition"
              >
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Bell className="h-3.5 w-3.5 text-red-500" />
                  {t("attention.overdue_followups")}
                </span>
                <span className={cn("text-lg font-bold tabular-nums", (dash.data?.slaAttention.counts.followUpsOverdue ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                  {dash.data?.slaAttention.counts.followUpsOverdue ?? 0}
                </span>
              </button>
              <button
                onClick={() => navigate("leads", { stageHealth: "STALE" })}
                className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left hover:bg-accent/60 transition"
              >
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Hourglass className="h-3.5 w-3.5 text-orange-500" />
                  {t("attention.stale_deals")}
                </span>
                <span className={cn("text-lg font-bold tabular-nums", (dash.data?.slaAttention.counts.staleDeals ?? 0) > 0 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>
                  {dash.data?.slaAttention.counts.staleDeals ?? 0}
                </span>
              </button>
            </div>
            {/* Top critical leads (Section 113) — a few items only, never a full list */}
            {(dash.data?.slaAttention?.items ?? []).length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-red-100 dark:border-red-900/50">
                {dash.data!.slaAttention.items.slice(0, 3).map((item: any) => (
                  <button
                    key={item.leadId}
                    onClick={() => navigate("lead", { id: item.leadId })}
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60 transition"
                  >
                    <span className="text-xs font-medium truncate min-w-0 flex-1">{item.leadName}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.issues.map((issue: any, i: number) => (
                        <span
                          key={i}
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                            issue.kind === "FIRST_RESPONSE" && "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
                            issue.kind === "FOLLOW_UP" && "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
                            issue.kind === "STAGE_INACTIVITY" && "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300"
                          )}
                        >
                          {issue.kind === "FIRST_RESPONSE" ? t("attention.no_first_response") : issue.kind === "FOLLOW_UP" ? t("attention.followup_overdue") : t("attention.stage_stale")}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TODAY — my work queue (Section 28: more useful than another KPI tile) */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="py-3.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              {t("followup.queue.title")}
            </p>
            <button onClick={() => navigate("leads", { followUp: "OVERDUE" })} className="flex items-baseline gap-1.5 text-sm hover:scale-[1.02] transition origin-left">
              <span className={cn("text-xl font-bold tabular-nums", (m?.overdueFollowups ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{m?.overdueFollowups ?? 0}</span>
              <span className="text-[11px] text-muted-foreground">{t("followup.queue.overdue")}</span>
            </button>
            <button onClick={() => navigate("leads", { followUp: "TODAY" })} className="flex items-baseline gap-1.5 text-sm hover:scale-[1.02] transition origin-left">
              <span className={cn("text-xl font-bold tabular-nums", (m?.followUpsDueToday ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{m?.followUpsDueToday ?? 0}</span>
              <span className="text-[11px] text-muted-foreground">{t("followup.queue.due_today")}</span>
            </button>
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className={cn("text-xl font-bold tabular-nums", (m?.meetingsToday ?? 0) > 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground")}>{m?.meetingsToday ?? 0}</span>
              <span className="text-[11px] text-muted-foreground">{t("followup.queue.meetings")}</span>
            </div>
            <button onClick={() => navigate("tasks")} className="flex items-baseline gap-1.5 text-sm hover:scale-[1.02] transition origin-left">
              <span className={cn("text-xl font-bold tabular-nums", (m?.tasksDueToday ?? 0) > 0 ? "text-foreground" : "text-muted-foreground")}>{m?.tasksDueToday ?? 0}</span>
              <span className="text-[11px] text-muted-foreground">{t("followup.queue.tasks")}</span>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4" /> {t("dashboard.by_source")}</CardTitle>
            <CardDescription className="text-xs">{totalActive} · {t("team.active")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-1">
            {dash.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
            {!dash.isLoading && bySource.filter((s) => s.count > 0).map((s) => (
              <MiniBar key={s.source} value={s.count} max={sourceMax} color="#0ea5e9" label={s.source} right={String(s.count)} />
            ))}
            {!dash.isLoading && bySource.every((s) => s.count === 0) && <EmptyState icon={Layers} title={t("common.empty")} />}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* mini revenue forecast */}
          {forecast && forecast.stages.some((s: any) => s.count > 0) && (
            <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent leados-lift">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <GaugeCircle className="h-4 w-4 text-primary" /> {t("analytics.forecast.title")}
                  <span className="ml-auto text-[10px] text-muted-foreground font-normal">{t("analytics.forecast.coverage")}: {forecast.empiricalCoverage}%</span>
                </CardTitle>
                <CardDescription className="text-xs">{t("analytics.forecast.subtitle")}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <button onClick={() => navigate("analytics")} className="w-full text-left group">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-2xl font-bold tabular-nums bg-gradient-to-r from-primary to-emerald-500 bg-clip-text text-transparent group-hover:from-primary/80 transition">
                        {formatMoney(forecast.weightedTotal)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{t("analytics.forecast.weighted")}</div>
                    </div>
                    <div className="flex gap-4 text-right">
                      <div>
                        <div className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(forecast.commit)}</div>
                        <div className="text-[10px] text-muted-foreground">{t("analytics.forecast.commit")}</div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold tabular-nums">{formatMoney(forecast.bestCase)}</div>
                        <div className="text-[10px] text-muted-foreground">{t("analytics.forecast.best")}</div>
                      </div>
                    </div>
                  </div>
                  {/* compact range bar */}
                  <div className="relative mt-3 h-2 rounded-full bg-muted">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 via-primary to-violet-400 transition-all duration-700" style={{ width: `${forecast.bestCase > 0 ? Math.min(100, Math.round((forecast.weightedTotal / forecast.bestCase) * 100)) : 0}%` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 h-3.5 w-[3px] rounded-full bg-emerald-500" style={{ left: `calc(${forecast.bestCase > 0 ? Math.min(99, Math.max(1, Math.round((forecast.commit / forecast.bestCase) * 100))) : 50}% - 1.5px)` }} />
                  </div>
                  {/* top stages by weighted value */}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[...forecast.stages]
                      .sort((a: any, b: any) => b.weightedValue - a.weightedValue)
                      .slice(0, 3)
                      .map((s: any) => (
                        <div key={s.stage} className="rounded-lg bg-background/60 border px-2 py-1.5">
                          <div className="text-[10px] text-muted-foreground truncate" title={s.stage}>{localizeStageName(t, s.stage)}</div>
                          <div className="text-xs font-semibold tabular-nums">{formatMoney(s.weightedValue)}</div>
                          <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                            <div className={cn("h-full rounded-full", s.empirical ? "bg-primary" : "bg-muted-foreground/40")} style={{ width: `${s.probability}%` }} />
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted-foreground group-hover:text-foreground transition">
                    {t("common.actions")} <ArrowUpRight className="h-3 w-3" />
                  </div>
                </button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> {t("dashboard.by_stage")}</CardTitle>
              <CardDescription className="text-xs">{t("analytics.funnel.title")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-1">
              {dash.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
              {!dash.isLoading && byStage.map((s) => (
                <MiniBar key={s.stage} value={s.count} max={stageMax} color={s.color ?? "#94a3b8"} label={localizeStageName(t, s.stage)} right={String(s.count)} />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* attention + recent + tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> {t("dashboard.attention")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0 max-h-80 overflow-y-auto">
            {lost.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            {!lost.isLoading && (lost.data?.flags ?? []).length === 0 && <EmptyState icon={CheckCircle2} title="All clear" hint="No leads need attention right now." />}
            {(lost.data?.flags ?? []).slice(0, 10).map((f: any) => (
              <button
                key={f.id}
                onClick={() => navigate("lead", { id: f.leadId })}
                className="w-full flex items-start gap-2.5 rounded-lg border bg-card p-2.5 text-left hover:bg-accent/60 transition"
              >
                <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", f.severity === "critical" ? "text-red-500" : f.severity === "warning" ? "text-amber-500" : "text-sky-500")} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{f.lead?.company || [f.lead?.firstName, f.lead?.lastName].filter(Boolean).join(" ") || "Lead"}</div>
                  <div className="text-[11px] text-muted-foreground">{f.message}</div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(f.detectedAt)}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Inbox className="h-4 w-4" /> {t("dashboard.recent_leads")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0 max-h-80 overflow-y-auto">
            {dash.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            {(dash.data?.recent ?? []).slice(0, 8).map((r: any) => (
              <button key={r.id} onClick={() => navigate("lead", { id: r.id })} className="w-full flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left hover:bg-accent/60 transition">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{r.company || r.email || r.phone || "—"}</div>
                </div>
                <SourceBadge name={r.source?.name} type={r.source?.type} />
                <ScoreBadge score={r.leadScore} category={r.scoreCategory} />
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(r.createdAt)}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Timer className="h-4 w-4 text-red-500" /> {t("dashboard.overdue_tasks")}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("tasks")} className="h-7 text-xs">{t("common.actions")} <ArrowUpRight className="h-3 w-3 ml-0.5" /></Button>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0 max-h-80 overflow-y-auto">
            {dash.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            {!dash.isLoading && (dash.data?.overdueTasks ?? []).length === 0 && <EmptyState icon={CheckCircle2} title="No overdue tasks" />}
            {(dash.data?.overdueTasks ?? []).slice(0, 8).map((task: any) => (
              <button key={task.id} onClick={() => task.lead?.id && navigate("lead", { id: task.lead.id })} className="w-full flex items-start gap-2.5 rounded-lg border bg-card p-2.5 text-left hover:bg-accent/60 transition">
                <Timer className="h-4 w-4 mt-0.5 text-red-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{task.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{task.lead?.company || "—"}</div>
                </div>
                <span className="text-[10px] text-red-500 font-medium shrink-0">{timeAgo(task.dueAt)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* activity stream */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> {t("dashboard.activity_stream")}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="relative max-h-72 overflow-y-auto pl-5">
            <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />
            {(dash.data?.activity ?? []).slice(0, 14).map((a: any) => (
              <div key={a.id} className="relative pb-3 last:pb-0">
                <span className="absolute -left-[11px] top-1.5 h-2.5 w-2.5 rounded-full bg-background border-2 border-primary/60" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{a.user?.name ?? "System"}</span>
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5">{a.type}</Badge>
                  <span className="text-[11px] text-muted-foreground ml-auto">{timeAgo(a.createdAt)}</span>
                </div>
                <p className="text-xs text-foreground/80">{a.title}{a.lead?.company ? ` · ${a.lead.company}` : ""}</p>
              </div>
            ))}
            {dash.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-full mb-2" />)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

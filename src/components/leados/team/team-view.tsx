"use client";

import { useTeamPerformance } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { localizeRole } from "@/lib/leados/i18n";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Trophy, Clock, AlertTriangle, Users, DollarSign, TrendingUp, Target } from "lucide-react";
import { LeadAvatar, EmptyState, formatMoney, timeAgo } from "../primitives";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function TeamView() {
  const { t } = useLocale();
  const team = useTeamPerformance();

  if (team.isLoading)
    return (
      <div className="px-4 md:px-6 py-5 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );

  const data = team.data;
  if (!data) return null;
  const users = data.users;
  const totals = data.totals;

  const chartData = users.map((u) => ({
    name: u.name.split(" ")[0],
    won: u.won,
    active: u.activeLeads,
    pipeline: Math.round((u.pipelineValue || 0) / 1000),
  }));

  return (
    <div className="px-4 md:px-6 py-5 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" />
          {t("team.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("team.subtitle")}</p>
      </div>

      {/* team totals KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <TeamKpi icon={Users} label={t("team.size")} value={String(totals.userCount ?? 0)} accent="#0ea5e9" />
        <TeamKpi icon={TrendingUp} label={t("team.active")} value={String(totals.totalActive ?? 0)} accent="#8b5cf6" />
        <TeamKpi icon={Trophy} label={t("team.won")} value={String(totals.totalWon ?? 0)} accent="#16a34a" />
        <TeamKpi icon={Target} label={t("team.lost")} value={String(totals.totalLost ?? 0)} accent="#dc2626" />
        <TeamKpi icon={Clock} label={t("team.open_tasks")} value={String(totals.totalOpenTasks ?? 0)} accent="#f59e0b" />
        <TeamKpi icon={AlertTriangle} label={t("team.overdue")} value={String(totals.totalOverdue ?? 0)} accent="#ef4444" critical />
      </div>

      {/* chart: won vs active per user */}
      {users.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4" />{t("team.chart.title")}</CardTitle>
            <CardDescription className="text-xs">{t("team.chart.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="active" fill="#0ea5e9" name={t("team.series.active")} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="won" fill="#16a34a" name={t("team.won")} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* user cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {users.length === 0 && <Card><CardContent><EmptyState icon={Users} title={t("team.no_members")} /></CardContent></Card>}
        {users.map((u, i) => (
          <motion.div
            key={u.userId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.22 }}
          >
            <Card className="leados-lift h-full">
              <CardContent className="p-4 space-y-3">
                {/* header */}
                <div className="flex items-center gap-3">
                  <LeadAvatar first={u.name} color={u.avatarColor} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{u.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{u.email} · {localizeRole(t, u.role)}</div>
                  </div>
                  <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", u.conversionRate >= 20 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                    {u.conversionRate}%
                  </span>
                </div>
                {/* metrics grid */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Metric label={t("team.leads")} value={u.totalAssigned} color="text-sky-600 dark:text-sky-400" />
                  <Metric label={t("team.won")} value={u.won} color="text-emerald-600 dark:text-emerald-400" />
                  <Metric label={t("team.lost")} value={u.lost} color="text-rose-600 dark:text-rose-400" />
                  <Metric label={t("team.tasks")} value={u.openTasks} color="text-amber-600 dark:text-amber-400" />
                </div>
                {/* extra metrics */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{t("team.avg_response")}</span>
                    <span className="font-medium tabular-nums">{u.avgResponseHours != null ? `${u.avgResponseHours}h` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{t("team.overdue_tasks")}</span>
                    <span className={cn("font-medium tabular-nums", u.overdueTasks > 0 && "text-red-500")}>{u.overdueTasks}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t">
                    <span className="text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />{t("team.won_value")}</span>
                    <span className="font-semibold tabular-nums">{formatMoney(u.wonValue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />{t("team.pipeline")}</span>
                    <span className="font-semibold tabular-nums">{formatMoney(u.pipelineValue)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function TeamKpi({ icon: Icon, label, value, accent, critical }: { icon: typeof Trophy; label: string; value: string; accent: string; critical?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", critical && Number(value) > 0 && "border-red-300/60 dark:border-red-900")}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center justify-center rounded-lg h-8 w-8" style={{ backgroundColor: accent + "1a" }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </span>
        {critical && Number(value) > 0 && <span className="h-2 w-2 rounded-full bg-red-500 leados-pulse" />}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground truncate">{label}</div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-muted/40 py-1.5">
      <div className={cn("text-lg font-bold tabular-nums", color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

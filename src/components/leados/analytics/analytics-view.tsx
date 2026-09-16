"use client";

import { useAnalytics } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie } from "recharts";
import { TrendingUp, Clock, Trophy, XCircle, Target, DollarSign, Activity, AlertCircle, Instagram, Facebook, MessageCircle, Send, Mail, Globe, Megaphone, Phone, Link2, User, Plus } from "lucide-react";
import { EmptyState, formatMoney } from "../primitives";
import { cn } from "@/lib/utils";

const SOURCE_COLOR: Record<string, string> = {
  instagram: "#E1306C",
  facebook: "#1877F2",
  whatsapp: "#25D366",
  telegram: "#0088CC",
  referral: "#8b5cf6",
  business_audit: "#14b8a6",
  google_ads: "#f59e0b",
  meta_ads: "#ec4899",
  website: "#0ea5e9",
  manual: "#64748b",
  api: "#a855f7",
  email: "#64748b",
  phone: "#6366f1",
  other: "#94a3b8",
};

const SOURCE_ICON_MAP: Record<string, typeof Instagram> = {
  website: Globe,
  business_audit: Target,
  instagram: Instagram,
  facebook: Facebook,
  whatsapp: MessageCircle,
  telegram: Send,
  google_ads: Megaphone,
  meta_ads: Megaphone,
  referral: Link2,
  manual: User,
  api: Plus,
  email: Mail,
  phone: Phone,
  other: Link2,
};

export function AnalyticsView() {
  const { t } = useLocale();
  const a = useAnalytics();

  if (a.isLoading) return <div className="px-4 md:px-6 py-5 space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-72 w-full" /><Skeleton className="h-72 w-full" /></div>;

  const data = a.data;
  if (!data) return null;

  return (
    <div className="px-4 md:px-6 py-5 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Activity className="h-6 w-6" />{t("analytics.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("analytics.subtitle")}</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={Activity} label={t("leads.title")} value={String(data.totalLeads)} accent="#0ea5e9" />
        <KpiCard icon={Target} label={t("analytics.conversion")} value={`${data.conversionRate}%`} accent="#16a34a" />
        <KpiCard icon={Clock} label={t("analytics.avg_response")} value={data.avgResponseHours != null ? `${data.avgResponseHours}h` : "—"} accent="#f59e0b" />
        <KpiCard icon={Trophy} label={t("metric.won")} value={String(data.won)} accent="#16a34a" />
        <KpiCard icon={DollarSign} label={t("pipeline.est_value")} value={formatMoney(data.openPipelineValue)} accent="#8b5cf6" />
        <KpiCard icon={XCircle} label={t("metric.lost")} value={String(data.lost)} accent="#dc2626" />
      </div>

      {/* leads over 7 days */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Leads · last 7 days</CardTitle>
          <CardDescription className="text-xs">Daily incoming volume</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.days} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* funnel */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pipeline funnel</CardTitle><CardDescription className="text-xs">Lead count & estimated value per stage</CardDescription></CardHeader>
          <CardContent className="pt-0">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.funnel} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                  <YAxis dataKey="stage" type="category" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={80} />
                  <Tooltip contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [v, "leads"]} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {data.funnel.map((s: any, i: number) => <Cell key={i} fill={s.color ?? "#94a3b8"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 space-y-1 text-xs">
              {data.funnel.map((s: any) => (
                <div key={s.stage} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color ?? "#94a3b8" }} />{s.stage}</span>
                  <span className="tabular-nums">{s.count} · {formatMoney(s.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* wins by source */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4" />{t("analytics.wins_by_source")}</CardTitle><CardDescription className="text-xs">Count & value of WON leads per source</CardDescription></CardHeader>
          <CardContent className="pt-0">
            {data.winsBySource.length === 0 ? (
              <EmptyState icon={Trophy} title={t("analytics.no_data")} />
            ) : (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.winsBySource} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {data.winsBySource.map((s: any, i: number) => <Cell key={i} fill={SOURCE_COLOR[s.type] ?? "#94a3b8"} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-2 space-y-1 text-xs">
              {data.winsBySource.map((s: any) => (
                <div key={s.type} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 capitalize"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: SOURCE_COLOR[s.type] ?? "#94a3b8" }} />{s.name}</span>
                  <span className="tabular-nums">{s.count} · {formatMoney(s.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* lost reasons */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4 text-rose-500" />{t("analytics.lost_reasons")}</CardTitle><CardDescription className="text-xs">Why leads are being lost — for funnel improvement</CardDescription></CardHeader>
        <CardContent className="pt-0">
          {data.lostReasons.length === 0 ? (
            <EmptyState icon={AlertCircle} title={t("analytics.no_data")} hint="No lost leads recorded yet." />
          ) : (
            <div className="space-y-2">
              {data.lostReasons.map((r: any) => {
                const pct = data.lost > 0 ? Math.round((r.count / data.lost) * 100) : 0;
                return (
                  <div key={r.reason} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{r.reason}</span>
                      <span className="tabular-nums text-muted-foreground">{r.count} · {pct}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "#dc2626" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* source ROI */}
      {data.sourceRoi && data.sourceRoi.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Source ROI</CardTitle>
            <CardDescription className="text-xs">Which sources bring leads, wins & revenue — for ad spend decisions</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-2 py-2">Source</th>
                    <th className="text-right font-medium px-2 py-2">Leads</th>
                    <th className="text-right font-medium px-2 py-2">Won</th>
                    <th className="text-right font-medium px-2 py-2">Lost</th>
                    <th className="text-right font-medium px-2 py-2">Conv.</th>
                    <th className="text-right font-medium px-2 py-2">Won value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sourceRoi.map((s) => {
                    const Icon = SOURCE_ICON_MAP[s.type] ?? Link2;
                    const color = SOURCE_COLOR[s.type] ?? "#64748b";
                    return (
                      <tr key={s.type} className="border-b last:border-0 hover:bg-accent/40 transition">
                        <td className="px-2 py-2">
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full" style={{ backgroundColor: color + "1a" }}>
                              <Icon className="h-3 w-3" style={{ color }} />
                            </span>
                            <span className="font-medium">{s.name}</span>
                          </span>
                        </td>
                        <td className="text-right tabular-nums px-2 py-2">{s.count}</td>
                        <td className="text-right tabular-nums px-2 py-2 text-emerald-600 dark:text-emerald-400 font-medium">{s.won}</td>
                        <td className="text-right tabular-nums px-2 py-2 text-rose-600 dark:text-rose-400">{s.lost}</td>
                        <td className="text-right tabular-nums px-2 py-2">
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium", s.conversion >= 20 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                            {s.conversion}%
                          </span>
                        </td>
                        <td className="text-right tabular-nums px-2 py-2 font-semibold">{formatMoney(s.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, accent }: { icon: typeof TrendingUp; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center justify-center rounded-lg h-8 w-8" style={{ backgroundColor: accent + "1a" }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground truncate">{label}</div>
    </div>
  );
}

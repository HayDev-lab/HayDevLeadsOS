"use client";

import { useAnalytics } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie } from "recharts";
import { TrendingUp, Clock, Trophy, XCircle, Target, DollarSign, Activity, AlertCircle, Instagram, Facebook, MessageCircle, Send, Mail, Globe, Megaphone, Phone, Link2, User, Plus, GaugeCircle, Info } from "lucide-react";
import { EmptyState, formatMoney } from "../primitives";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

      {/* revenue forecast */}
      {data.forecast && <ForecastCard forecast={data.forecast} />}

      {/* leads over 7 days */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />{t("analytics.7days.title")}</CardTitle>
          <CardDescription className="text-xs">{t("analytics.7days.desc")}</CardDescription>
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
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("analytics.funnel.title")}</CardTitle><CardDescription className="text-xs">{t("analytics.funnel.desc")}</CardDescription></CardHeader>
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
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4" />{t("analytics.wins_by_source")}</CardTitle><CardDescription className="text-xs">{t("analytics.wins.desc")}</CardDescription></CardHeader>
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
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4 text-rose-500" />{t("analytics.lost_reasons")}</CardTitle><CardDescription className="text-xs">{t("analytics.lost.desc")}</CardDescription></CardHeader>
        <CardContent className="pt-0">
          {data.lostReasons.length === 0 ? (
            <EmptyState icon={AlertCircle} title={t("analytics.no_data")} hint={t("analytics.no_data")} />
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

      {/* 30-day trend heatmap + response time distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.trend30 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />{t("analytics.trend.title")}</CardTitle>
              <CardDescription className="text-xs">{t("analytics.trend.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-10 gap-1">
                {data.trend30.map((d: any) => {
                  const maxCount = Math.max(1, ...data.trend30.map((x: any) => x.count));
                  const intensity = d.count / maxCount;
                  const wonIntensity = d.won / Math.max(1, maxCount);
                  return (
                    <div
                      key={d.date}
                      title={`${d.date}: ${d.count} new, ${d.won} won`}
                      className="aspect-square rounded relative group transition-transform hover:scale-110 hover:z-10"
                      style={{ backgroundColor: `color-mix(in oklch, var(--primary) ${Math.round(intensity * 80)}%, transparent)` }}
                    >
                      {d.won > 0 && (
                        <span
                          className="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full bg-emerald-500"
                          style={{ opacity: 0.4 + wonIntensity * 0.6 }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                <span>{t("analytics.heatmap.ago")}</span>
                <div className="flex items-center gap-1">
                  <span>{t("analytics.heatmap.less")}</span>
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "color-mix(in oklch, var(--primary) 20%, transparent)" }} />
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "color-mix(in oklch, var(--primary) 50%, transparent)" }} />
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "color-mix(in oklch, var(--primary) 80%, transparent)" }} />
                  <span>{t("analytics.heatmap.more")}</span>
                </div>
                <span>{t("analytics.heatmap.today")}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {data.respBuckets && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" />{t("analytics.resp.title")}</CardTitle>
              <CardDescription className="text-xs">{t("analytics.resp.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {[
                  { key: "0-1h", label: t("analytics.resp.0_1h"), color: "#16a34a" },
                  { key: "1-4h", label: t("analytics.resp.1_4h"), color: "#0ea5e9" },
                  { key: "4-24h", label: t("analytics.resp.4_24h"), color: "#f59e0b" },
                  { key: "1-3d", label: t("analytics.resp.1_3d"), color: "#f97316" },
                  { key: "3d+", label: t("analytics.resp.3d"), color: "#dc2626" },
                  { key: "none", label: t("analytics.resp.none"), color: "#94a3b8" },
                ].map((b) => {
                  const val = data.respBuckets[b.key] ?? 0;
                  const total = Object.values(data.respBuckets).reduce((a: number, x: any) => a + (x as number), 0);
                  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                  return (
                    <div key={b.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                          {b.label}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{val} · {pct}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: b.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* source ROI */}
      {data.sourceRoi && data.sourceRoi.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />{t("analytics.roi.title")}</CardTitle>
            <CardDescription className="text-xs">{t("analytics.roi.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-2 py-2">{t("analytics.roi.source")}</th>
                    <th className="text-right font-medium px-2 py-2">{t("analytics.roi.leads")}</th>
                    <th className="text-right font-medium px-2 py-2">{t("metric.won")}</th>
                    <th className="text-right font-medium px-2 py-2">{t("metric.lost")}</th>
                    <th className="text-right font-medium px-2 py-2">{t("analytics.roi.conv")}</th>
                    <th className="text-right font-medium px-2 py-2">{t("analytics.roi.value")}</th>
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

// ---------------------------------------------------------------------------
// REVENUE FORECAST — stage-weighted pipeline (v0.18).
// Empirical probabilities (from STAGE_CHANGE history) are shown as facts;
// position-based fallbacks are visually muted and labeled as estimates.
// ---------------------------------------------------------------------------

type ForecastStage = {
  stage: string;
  color?: string | null;
  count: number;
  value: number;
  probability: number;
  empirical: boolean;
  resolvedSamples: number;
  weightedValue: number;
};

type Forecast = {
  stages: ForecastStage[];
  weightedTotal: number;
  bestCase: number;
  commit: number;
  empiricalCoverage: number;
};

function ForecastCard({ forecast }: { forecast: Forecast }) {
  const { t } = useLocale();
  const { weightedTotal, bestCase, commit, stages, empiricalCoverage } = forecast;
  // Position markers for the range bar (0..100% of bestCase).
  const pct = (v: number) => (bestCase > 0 ? Math.min(100, Math.max(0, Math.round((v / bestCase) * 100))) : 0);
  const hasData = stages.some((s) => s.count > 0);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
          <CardTitle className="text-sm flex items-center gap-2">
            <GaugeCircle className="h-4 w-4 text-primary" />
            {t("analytics.forecast.title")}
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground normal-case">
              <Info className="h-3 w-3" />
              {t("analytics.forecast.coverage")}: {empiricalCoverage}%
            </span>
          </CardTitle>
          <CardDescription className="text-xs">{t("analytics.forecast.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-3 space-y-4">
          {!hasData ? (
            <EmptyState icon={GaugeCircle} title={t("analytics.no_data")} hint={t("analytics.forecast.hint")} />
          ) : (
            <>
              {/* headline: weighted forecast + range bar */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("analytics.forecast.weighted")}</div>
                  <div className="text-3xl font-bold tabular-nums bg-gradient-to-r from-primary to-emerald-500 bg-clip-text text-transparent">
                    {formatMoney(weightedTotal)}
                  </div>
                </div>
                <div className="flex-1 min-w-[180px] sm:mb-2">
                  {/* range bar: commit -> weighted -> best case */}
                  <div className="relative h-3 rounded-full bg-muted overflow-visible">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 via-primary to-violet-400" style={{ width: `${pct(weightedTotal)}%` }} />
                    {[
                      { v: commit, cls: "bg-emerald-500", lbl: t("analytics.forecast.commit") },
                      { v: weightedTotal, cls: "bg-primary", lbl: t("analytics.forecast.weighted") },
                      { v: bestCase, cls: "bg-violet-400", lbl: t("analytics.forecast.best") },
                    ].map((m) => (
                      <div key={m.lbl} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: `${Math.max(2, Math.min(98, pct(m.v)))}%` }}>
                        <span className={cn("h-4 w-1 rounded-full", m.cls)} />
                        <span className="mt-1 text-[9px] text-muted-foreground whitespace-nowrap hidden sm:block">{m.lbl}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] tabular-nums text-muted-foreground sm:mt-4">
                    <span>{formatMoney(commit)}</span>
                    <span>{formatMoney(bestCase)}</span>
                  </div>
                </div>
              </div>

              {/* per-stage breakdown */}
              <TooltipProvider delayDuration={150}>
                <div className="space-y-1.5">
                  {stages.map((s, i) => (
                    <motion.div
                      key={s.stage}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 + i * 0.04, duration: 0.2 }}
                      className="group grid grid-cols-[1fr_auto] sm:grid-cols-[130px_60px_1fr_90px_100px] items-center gap-x-3 rounded-lg px-2 py-1.5 hover:bg-accent/40 transition-colors"
                    >
                      {/* stage name */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
                        <span className="text-xs font-medium truncate">{s.stage}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">×{s.count}</span>
                      </div>
                      {/* value */}
                      <div className="hidden sm:block text-right text-xs tabular-nums text-muted-foreground">{formatMoney(s.value)}</div>
                      {/* probability bar */}
                      <div className="col-span-2 sm:col-span-1 order-3 sm:order-none">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all", s.empirical ? "bg-primary" : "bg-muted-foreground/40 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.25)_3px,rgba(255,255,255,.25)_6px)]")}
                              style={{ width: `${s.probability}%` }}
                            />
                          </div>
                          <UiTooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={cn(
                                  "shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums cursor-help",
                                  s.empirical
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted text-muted-foreground border border-dashed"
                                )}
                              >
                                {s.probability}%
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {s.empirical ? t("analytics.forecast.empirical") : t("analytics.forecast.estimate")} · {s.resolvedSamples} sample{s.resolvedSamples === 1 ? "" : "s"}
                            </TooltipContent>
                          </UiTooltip>
                        </div>
                      </div>
                      {/* weighted value */}
                      <div className="hidden sm:block text-right text-xs font-semibold tabular-nums">{formatMoney(s.weightedValue)}</div>
                      {/* mobile value row (second line) */}
                      <div className="sm:hidden col-span-2 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground -mt-1">
                        <span>{formatMoney(s.value)}</span>
                        <span className="font-semibold text-foreground">{formatMoney(s.weightedValue)}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </TooltipProvider>
              <p className="text-[10px] text-muted-foreground border-t pt-2">{t("analytics.forecast.hint")}</p>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function KpiCard({ icon: Icon, label, value, accent }: { icon: typeof TrendingUp; label: string; value: string; accent: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-xl border bg-card p-3 leados-lift"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center justify-center rounded-lg h-8 w-8" style={{ backgroundColor: accent + "1a" }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground truncate">{label}</div>
    </motion.div>
  );
}

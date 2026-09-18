"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PRIORITY, SCORE_CATEGORY, type ScoreCategory } from "@/lib/leados/constants";
import { useT } from "@/lib/leados/locale";
import { localizeStageName } from "@/lib/leados/i18n";
import { initials } from "@/lib/leados/normalize";
import { useSession } from "@/hooks/leados/use-api";

// ---------- time ----------

export function timeAgo(d?: Date | string | null): string {
  if (!d) return "—";
  const t = new Date(d).getTime();
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const min = 60_000, hr = 3_600_000, day = 86_400_000;
  let s: string;
  if (abs < min) s = "now";
  else if (abs < hr) s = `${Math.round(abs / min)}m`;
  else if (abs < day) s = `${Math.round(abs / hr)}h`;
  else if (abs < 30 * day) s = `${Math.round(abs / day)}d`;
  else s = new Date(t).toLocaleDateString();
  if (s === "now") return s;
  return future ? `in ${s}` : `${s} ago`;
}

export function formatDate(d?: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export function formatDay(d?: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
export function formatMoney(value?: number | null, currency = "AMD"): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ${currency}`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K ${currency}`;
  return `${value} ${currency}`;
}

// ---------- score ----------

const SCORE_COLOR: Record<ScoreCategory, string> = {
  LOW: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  HIGH: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
};

export function ScoreBadge({ score, category, size = "sm" }: { score?: number | null; category?: string | null; size?: "sm" | "md" }) {
  const t = useT();
  const cat = (category as ScoreCategory) ?? SCORE_CATEGORY.LOW;
  const label = cat === SCORE_CATEGORY.HIGH ? t("score.high") : cat === SCORE_CATEGORY.MEDIUM ? t("score.medium") : t("score.low");
  if (score == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md font-medium", SCORE_COLOR[cat] ?? SCORE_COLOR.LOW, size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs")}>
      <span className="font-semibold tabular-nums">{score}</span>
      <span className="opacity-70">·</span>
      <span>{label}</span>
    </span>
  );
}

// ---------- priority ----------

const PRIORITY_COLOR: Record<string, string> = {
  // v0.22: LOW/MEDIUM text darkened one step (light) and lightened one step
  // (dark) — VLM flagged the washed-out look in both modes.
  URGENT: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-900",
  HIGH: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300 border-orange-200 dark:border-orange-900",
  MEDIUM: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200 border-sky-200 dark:border-sky-900",
  LOW: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700",
};

export function PriorityBadge({ priority }: { priority?: string | null }) {
  const t = useT();
  if (!priority) return <span className="text-muted-foreground">—</span>;
  const key = priority.toLowerCase() as keyof typeof PRIORITY_COLOR;
  const label = priority === PRIORITY.URGENT ? t("priority.urgent") : priority === PRIORITY.HIGH ? t("priority.high") : priority === PRIORITY.MEDIUM ? t("priority.medium") : t("priority.low");
  return <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium", PRIORITY_COLOR[key] ?? PRIORITY_COLOR.LOW)}>{label}</span>;
}

// ---------- stage / status ----------

export function StageBadge({ name, color, type }: { name?: string | null; color?: string | null; type?: string | null }) {
  const t = useT();
  if (!name) return <span className="text-muted-foreground">—</span>;
  const isWon = type === "won";
  const isLost = type === "lost";
  // v0.22: canonical English stage names localize for display; custom
  // org-renamed names render verbatim. Raw name stays in the tooltip.
  const display = localizeStageName(t, name);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" title={display !== name ? name : undefined}>
      <span
        className={cn("h-2 w-2 rounded-full", isWon && "ring-2 ring-emerald-400/30", isLost && "opacity-60")}
        style={{ backgroundColor: color ?? "#94a3b8" }}
      />
      <span className={cn(isLost && "line-through text-muted-foreground")}>{display}</span>
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const t = useT();
  const key = status.toLowerCase() as "new" | "open" | "contacted" | "qualified" | "won" | "lost" | "archived";
  const color: Record<string, string> = {
    new: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    open: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    contacted: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
    qualified: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
    won: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    lost: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
    archived: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };
  const labelKey = `status.${key}` as Parameters<typeof t>[0];
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", color[key] ?? color.new)}>{t(labelKey)}</span>;
}

// ---------- owner / avatar ----------

export function LeadAvatar({ first, last, color, size = 28 }: { first?: string | null; last?: string | null; color?: string | null; size?: number }) {
  const ini = initials(first, last);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color ?? "#64748b", fontSize: Math.round(size * 0.38) }}
    >
      {ini}
    </span>
  );
}

export function OwnerChip({ name, avatarColor }: { name?: string | null; avatarColor?: string | null }) {
  const t = useT();
  if (!name) return <span className="text-xs text-muted-foreground italic">{t("common.unassigned")}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <LeadAvatar first={name} color={avatarColor} size={20} />
      <span className="text-xs font-medium truncate max-w-[120px]">{name}</span>
    </span>
  );
}

// ---------- source ----------

import { Globe, LayoutDashboard, Instagram, Facebook, MessageCircle, Send, Megaphone, Phone, Mail, Link2, User, Plus } from "lucide-react";

const SOURCE_ICON: Record<string, typeof Globe> = {
  website: Globe,
  business_audit: LayoutDashboard,
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

export function SourceBadge({ name, type }: { name?: string | null; type?: string | null }) {
  const Icon = (type && SOURCE_ICON[type]) || Link2;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate max-w-[120px]">{name || type || "—"}</span>
    </span>
  );
}

// ---------- attention ----------

const SEV_COLOR: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-900",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-900",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border-sky-200 dark:border-sky-900",
};

export function AttentionBadge({ severity, message }: { severity: string; message?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium", SEV_COLOR[severity] ?? SEV_COLOR.warning)}>
      {message ?? severity}
    </span>
  );
}

// ---------- mini bar (distribution) ----------

export function MiniBar({ value, max, color = "#0ea5e9", label, right }: { value: number; max: number; color?: string; label?: string; right?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground/80 truncate">{label}</span>
        <span className="tabular-nums text-muted-foreground">{right ?? value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ---------- empty state ----------

export function EmptyState({ icon: Icon, title, hint }: { icon: typeof Globe; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="rounded-full bg-muted p-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground max-w-sm">{hint}</p>}
    </div>
  );
}

// ---------- demo badge ----------

export function DemoBadge() {
  // v0.17 (spec 67–68): the DEMO MODE banner renders ONLY for demo sessions
  // — a production login never shows synthetic-data hints.
  const { data } = useSession();
  const isDemo = data?.session?.demo ?? false;
  const t = useT();
  if (!isDemo) return null;
  return (
    <Badge variant="secondary" className="border border-amber-300/60 bg-amber-100/70 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      {t("common.demo")} · {t("common.demoSynthetic")}
    </Badge>
  );
}

// ---------- tag chip ----------

export function TagChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        color: color ?? "#475569",
        backgroundColor: (color ?? "#64748b") + "1a",
      }}
    >
      {name}
    </span>
  );
}

"use client";

// Shared notification rendering: templateKey + payload → localized title and
// message (spec Sections 43–47 — localization happens at display time in the
// viewer's locale; the DB stores structured data, never a frozen translation).

import { AlertTriangle, BellRing, CheckCircle2, Clock, Info, OctagonAlert } from "lucide-react";
import { humanizeDuration } from "@/lib/sla";
import { localizeStageName, type DictKey } from "@/lib/leados/i18n";
import { timeAgo } from "../primitives";
import { cn } from "@/lib/utils";
import type { NotificationRow } from "@/hooks/leados/use-api";

type TFunc = (key: DictKey, vars?: Record<string, string | number>) => string;
const asKey = (k: string) => k as DictKey;

/** Localized title/message for a notification row. Falls back to the stored
 *  English snapshot when the template is missing (legacy rows). */
export function renderNotificationText(n: NotificationRow, t: TFunc): { title: string; message: string } {
  if (!n.templateKey) return { title: n.title, message: n.message };
  const titleKey = n.templateKey;
  const messageKey = n.templateKey.replace(/\.title$/, ".message");
  const p = n.payload ?? {};
  const leadPart = p.leadName ? ` · ${String(p.leadName)}` : "";
  const vars = {
    name: String(p.leadName ?? p.taskTitle ?? ""),
    // v0.22: canonical stage names localize inside messages too (display-only).
    stage: p.stageName ? localizeStageName(t, String(p.stageName)) : "",
    task: String(p.taskTitle ?? ""),
    leadPart: leadPart || "",
    duration: humanizeDuration(Number(p.overdueMinutes ?? p.remainingMinutes ?? 0)),
    threshold: humanizeDuration(Number(p.thresholdMinutes ?? 0)),
  };
  return {
    title: t(asKey(titleKey), vars) === titleKey ? n.title : t(asKey(titleKey), vars),
    message: t(asKey(messageKey), vars) === messageKey ? n.message : t(asKey(messageKey), vars),
  };
}

/** Severity visual metadata (Section 79): icon + tint, never color-only. */
export function severityMeta(sev: string): {
  icon: typeof Info;
  labelKey: string;
  chipClass: string;
  iconClass: string;
  dotClass: string;
} {
  switch (sev) {
    case "CRITICAL":
      return {
        icon: OctagonAlert,
        labelKey: "notif.severity.critical",
        chipClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
        iconClass: "text-red-600 dark:text-red-400",
        dotClass: "bg-red-500",
      };
    case "WARNING":
      return {
        icon: Clock,
        labelKey: "notif.severity.warning",
        chipClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
        iconClass: "text-amber-600 dark:text-amber-400",
        dotClass: "bg-amber-500",
      };
    default:
      return {
        icon: Info,
        labelKey: "notif.severity.info",
        chipClass: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
        iconClass: "text-sky-600 dark:text-sky-400",
        dotClass: "bg-sky-500",
      };
  }
}

/** Deep link navigation: parses the stored hash-route link ("lead/<id>?focus=…"). */
export function parseDeepLink(deepLink: string | null): { view: string; id?: string; params: Record<string, string> } | null {
  if (!deepLink) return null;
  const clean = deepLink.replace(/^\/?#?\/?/, "");
  const [path, query] = clean.split("?");
  const segs = path.split("/").filter(Boolean);
  const view = segs[0] ?? "dashboard";
  const params: Record<string, string> = {};
  if (query) {
    for (const part of query.split("&")) {
      const [k, v] = part.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  return { view, id: segs[1], params };
}

export interface NotificationCardProps {
  n: NotificationRow;
  t: TFunc;
  onOpen?: (n: NotificationRow) => void;
  compact?: boolean;
  /** v0.16 (spec 62): external delivery statuses for this notification. */
  deliveries?: { channel: string; status: string }[] | null;
}

function deliveryChipClass(status: string): string {
  if (status === "SENT") return "border-emerald-300 text-emerald-700 dark:text-emerald-300";
  if (status === "FAILED" || status === "FAILED_RETRYABLE") return "border-red-300 text-red-700 dark:text-red-300";
  if (status === "PENDING" || status === "SENDING") return "border-sky-300 text-sky-700 dark:text-sky-300";
  return "border-border text-muted-foreground";
}

/** One notification row: severity chip, localized title/message, relative
 *  time, unread dot, resolved badge, deep link (Section 36). */
export function NotificationCard({ n, t, onOpen, compact = false, deliveries }: NotificationCardProps) {
  const meta = severityMeta(n.severity);
  const { title, message } = renderNotificationText(n, t);
  const Icon = n.resolvedAt ? CheckCircle2 : meta.icon;
  const unread = !n.readAt;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(n)}
      className={cn(
        "w-full text-left rounded-lg border transition group",
        "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        unread ? "bg-primary/[0.04] border-primary/15" : "bg-card border-border",
        n.resolvedAt && "opacity-70"
      )}
    >
      <div className={cn("flex items-start gap-2.5", compact ? "p-2.5" : "p-3")}>
        <span
          className={cn(
            "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
            n.resolvedAt
              ? "bg-muted/40 border-border text-muted-foreground"
              : meta.chipClass
          )}
          aria-label={t(asKey(meta.labelKey))}
        >
          <Icon className={cn("h-3.5 w-3.5", n.resolvedAt ? "" : meta.iconClass)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {unread && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dotClass)} aria-hidden />}
            <span className={cn("truncate font-medium", compact ? "text-xs" : "text-sm")}>{title}</span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground" suppressHydrationWarning>
              {timeAgo(n.createdAt)}
            </span>
          </div>
          <p className={cn("mt-0.5 text-muted-foreground", compact ? "text-[11px] leading-snug" : "text-xs leading-relaxed")}>
            {message}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide",
                n.resolvedAt ? "border-border bg-muted/40 text-muted-foreground" : meta.chipClass
              )}
            >
              {n.resolvedAt ? <CheckCircle2 className="h-2.5 w-2.5" /> : <BellRing className="h-2.5 w-2.5" />}
              {n.resolvedAt ? t(asKey("notif.resolved_badge")) : t(asKey(meta.labelKey))}
            </span>
            {/* v0.16 (spec 62): "Notification happened · Email sent · Telegram failed" — no stack traces. */}
            {(deliveries ?? []).map((d) => (
              <span
                key={`${d.channel}-${d.status}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide",
                  deliveryChipClass(d.status)
                )}
                title={t(asKey(`delivery.status.${d.status}` as never))}
              >
                {t(asKey(`delivery.channel.${d.channel}` as never))} · {t(asKey(`delivery.status.${d.status}` as never))}
              </span>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}

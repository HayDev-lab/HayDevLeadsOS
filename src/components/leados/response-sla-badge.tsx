"use client";

import { cn } from "@/lib/utils";
import { Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

interface SlaProps {
  createdAt?: Date | string | null;
  lastContactAt?: Date | string | null;
  status?: string;
}

// SLA thresholds (hours)
const SLA_RESPONSE_TARGET = 1; // respond within 1 hour
const SLA_RESPONSE_WARNING = 4; // warning after 4 hours
const SLA_RESPONSE_BREACH = 24; // breach after 24 hours

/**
 * Response time SLA badge — shows whether a lead was responded to within target.
 * Green: responded < 1h, Amber: 1-4h, Orange: 4-24h, Red: >24h or no response.
 */
export function ResponseSlaBadge({ createdAt, lastContactAt, status }: SlaProps) {
  if (status === "WON" || status === "LOST" || status === "ARCHIVED") return null;

  const created = createdAt ? new Date(createdAt).getTime() : null;
  const contacted = lastContactAt ? new Date(lastContactAt).getTime() : null;
  if (!created) return null;

  let hours: number;
  let label: string;
  let color: string;
  let Icon = Clock;

  if (contacted && contacted > created) {
    hours = (contacted - created) / 3600000;
    if (hours <= SLA_RESPONSE_TARGET) {
      label = `< 1h`;
      color = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300";
      Icon = CheckCircle2;
    } else if (hours <= SLA_RESPONSE_WARNING) {
      label = `${Math.round(hours)}h`;
      color = "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
    } else if (hours <= SLA_RESPONSE_BREACH) {
      label = `${Math.round(hours)}h`;
      color = "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300";
    } else {
      label = `${Math.round(hours)}h`;
      color = "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
      Icon = AlertTriangle;
    }
  } else {
    // no contact yet — measure from creation
    hours = (Date.now() - created) / 3600000;
    if (hours <= SLA_RESPONSE_TARGET) {
      label = "new";
      color = "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300";
    } else if (hours <= SLA_RESPONSE_WARNING) {
      label = `${Math.round(hours)}h`;
      color = "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
      Icon = AlertTriangle;
    } else if (hours <= SLA_RESPONSE_BREACH) {
      label = `${Math.round(hours)}h`;
      color = "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300";
      Icon = AlertTriangle;
    } else {
      label = `${Math.round(hours)}h`;
      color = "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
      Icon = AlertTriangle;
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", color)} title={`Response time: ${label}`}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

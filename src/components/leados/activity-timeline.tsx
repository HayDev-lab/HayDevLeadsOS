"use client";

import { cn } from "@/lib/utils";
import { Phone, MessageSquare, Mail, Calendar, StickyNote, UserPlus, ArrowLeftRight, Trophy, XCircle, FileText, Zap, GitMerge, Archive, Bell, type LucideIcon } from "lucide-react";
import { timeAgo } from "./primitives";

// Activity type → icon + color mapping
const ACTIVITY_META: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  CALL: { icon: Phone, color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-100 dark:bg-sky-950/50" },
  MESSAGE: { icon: MessageSquare, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-100 dark:bg-violet-950/50" },
  EMAIL: { icon: Mail, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-100 dark:bg-indigo-950/50" },
  MEETING: { icon: Calendar, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-100 dark:bg-purple-950/50" },
  FOLLOW_UP: { icon: Bell, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-950/50" },
  NOTE: { icon: StickyNote, color: "text-slate-600 dark:text-slate-400", bg: "bg-slate-100 dark:bg-slate-800/50" },
  STATUS_CHANGE: { icon: ArrowLeftRight, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-950/50" },
  STAGE_CHANGE: { icon: ArrowLeftRight, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-950/50" },
  ASSIGNMENT: { icon: UserPlus, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-950/50" },
  SYSTEM_EVENT: { icon: Zap, color: "text-slate-500 dark:text-slate-400", bg: "bg-slate-100 dark:bg-slate-800/50" },
  AUDIT_IMPORT: { icon: FileText, color: "text-teal-600 dark:text-teal-400", bg: "bg-teal-100 dark:bg-teal-950/50" },
};

export interface TimelineEntry {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  createdAt: string | Date;
  user?: { name?: string | null } | null;
  metadata?: any;
}

export function ActivityTimeline({ entries, max_height = "max-h-96" }: { entries: TimelineEntry[]; max_height?: string }) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-3 mb-3">
          <Zap className="h-6 w-6 text-muted-foreground/40" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Log a call, message, or note to start the timeline.</p>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-y-auto pl-2", max_height)}>
      {/* vertical line */}
      <div className="absolute left-[19px] top-3 bottom-3 w-px bg-gradient-to-b from-border via-border to-transparent" />
      <div className="space-y-1">
        {entries.map((entry, i) => {
          const meta = ACTIVITY_META[entry.type] ?? ACTIVITY_META.SYSTEM_EVENT;
          const Icon = meta.icon;
          const isLast = i === entries.length - 1;
          return (
            <div
              key={entry.id}
              className="relative flex gap-3 group hover:bg-accent/30 -mx-2 px-2 py-2 rounded-lg transition"
            >
              {/* icon node */}
              <div className={cn("relative z-10 shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full border-2 border-background", meta.bg)}>
                <Icon className={cn("h-3.5 w-3.5", meta.color)} />
              </div>
              {/* content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate">{entry.user?.name ?? "System"}</span>
                  <span className={cn("text-[9px] font-semibold uppercase px-1 py-px rounded", meta.bg, meta.color)}>
                    {entry.type.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition">{timeAgo(entry.createdAt)}</span>
                </div>
                <p className="text-xs text-foreground/80 leading-relaxed">{entry.title}</p>
                {entry.description && <p className="text-[11px] text-muted-foreground mt-0.5">{entry.description}</p>}
                {/* timestamp always visible for last entry */}
                {isLast && <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(entry.createdAt)} ago</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

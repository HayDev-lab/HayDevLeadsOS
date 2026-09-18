"use client";

import { useState } from "react";
import { useInbox, useInboxStats, useLinkMessage, useCreateLeadFromMessage, useLeads } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { useHashRoute } from "@/lib/leados/hash-route";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Inbox as InboxIcon, Instagram, Facebook, MessageCircle, Send, Mail, Globe, Plus, Link2, ArrowRight, Filter, Clock } from "lucide-react";
import { timeAgo, EmptyState, LeadAvatar } from "../primitives";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const SOURCE_ICON: Record<string, typeof Instagram> = {
  instagram: Instagram,
  facebook: Facebook,
  whatsapp: MessageCircle,
  telegram: Send,
  email: Mail,
  website: Globe,
  api: Plus,
};
const SOURCE_COLOR: Record<string, string> = {
  instagram: "#E1306C",
  facebook: "#1877F2",
  whatsapp: "#25D366",
  telegram: "#0088CC",
  email: "#64748b",
  website: "#0ea5e9",
  api: "#8b5cf6",
};

export function InboxView() {
  const { t } = useLocale();
  const [, navigate] = useHashRoute();
  const [source, setSource] = useState<string>("");
  const [unassigned, setUnassigned] = useState(false);
  const [activeConv, setActiveConv] = useState<string | null>(null);

  const inbox = useInbox(source || undefined, unassigned);
  const stats = useInboxStats();

  const conversations = inbox.data?.conversations ?? [];
  const active = conversations.find((c: any) => c.id === activeConv) ?? conversations[0];
  const activeMessages = (active?.messages ?? []).slice().reverse(); // chronological

  return (
    <div className="px-4 md:px-6 py-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <InboxIcon className="h-6 w-6" />
            {t("inbox.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("inbox.subtitle")} · {inbox.data?.total ?? 0} {t("inbox.messages").toLowerCase()}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stats.data && (
            <>
              <StatChip label={t("inbox.last_24h")} value={stats.data.last24h} />
              <StatChip label={t("inbox.unassigned")} value={stats.data.unassigned} accent />
              <StatChip label={t("inbox.all")} value={stats.data.total} />
            </>
          )}
        </div>
      </div>

      {/* source filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <button
          onClick={() => { setSource(""); setUnassigned(false); }}
          className={cn("h-8 px-3 rounded-full text-xs font-medium border transition", !source && !unassigned ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent")}
        >
          {t("inbox.all")}
        </button>
        {["instagram", "whatsapp", "telegram", "facebook", "email", "website"].map((s) => {
          const Icon = SOURCE_ICON[s] ?? InboxIcon;
          const active2 = source === s;
          const count = stats.data?.bySource?.find((b: any) => b.source === s)?.count ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={s}
              onClick={() => { setSource(active2 ? "" : s); setUnassigned(false); }}
              className={cn("h-8 px-3 rounded-full text-xs font-medium border inline-flex items-center gap-1.5 transition", active2 ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent")}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: active2 ? undefined : SOURCE_COLOR[s] }} />
              <span className="capitalize">{s}</span>
              <span className={cn("ml-1 text-[10px] rounded-full px-1", active2 ? "bg-primary-foreground/20" : "bg-muted")}>{count}</span>
            </button>
          );
        })}
        <button
          onClick={() => setUnassigned((v) => !v)}
          className={cn("h-8 px-3 rounded-full text-xs font-medium border inline-flex items-center gap-1.5 transition", unassigned ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300" : "bg-background hover:bg-accent")}
        >
          <Link2 className="h-3.5 w-3.5" />
          {t("inbox.unassigned")}
          {stats.data?.unassigned ? <span className="ml-1 text-[10px] rounded-full px-1 bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200">{stats.data.unassigned}</span> : null}
        </button>
      </div>

      {inbox.isLoading && <Skeleton className="h-80 w-full" />}

      {!inbox.isLoading && conversations.length === 0 && (
        <Card>
          <EmptyState icon={InboxIcon} title={t("inbox.empty")} hint={t("inbox.architecture_note")} />
        </Card>
      )}

      {conversations.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 h-[calc(100vh-280px)] min-h-[420px]">
          {/* conversation list */}
          <Card className="lg:col-span-1 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("inbox.conversations")} · {conversations.length}</div>
            <div className="flex-1 overflow-y-auto">
              {conversations.map((c: any) => {
                const Icon = SOURCE_ICON[c.source] ?? InboxIcon;
                const isActive = active?.id === c.id;
                const last = c.messages[0];
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveConv(c.id)}
                    className={cn("w-full flex items-start gap-2.5 px-3 py-2.5 text-left border-b last:border-0 transition", isActive ? "bg-accent" : "hover:bg-accent/60")}
                  >
                    <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full shrink-0" style={{ backgroundColor: (SOURCE_COLOR[c.source] ?? "#64748b") + "1a" }}>
                      <Icon className="h-4 w-4" style={{ color: SOURCE_COLOR[c.source] }} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{c.handle || c.source}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(c.lastAt)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{last?.content}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", c.leadId ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300")}>
                          {c.leadId ? t("inbox.linked_to") : t("inbox.unlinked")}
                        </span>
                        {c.lead && <span className="text-[10px] text-muted-foreground truncate">{c.lead.company || [c.lead.firstName, c.lead.lastName].filter(Boolean).join(" ")}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* message thread */}
          <Card className="lg:col-span-2 overflow-hidden flex flex-col">
            {active ? (
              <>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full shrink-0" style={{ backgroundColor: (SOURCE_COLOR[active.source] ?? "#64748b") + "1a" }}>
                      {(() => { const Icon = SOURCE_ICON[active.source] ?? InboxIcon; return <Icon className="h-4 w-4" style={{ color: SOURCE_COLOR[active.source] }} />; })()}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{active.handle || active.source}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {active.lead ? (
                          <button onClick={() => active.leadId && navigate("lead", { id: active.leadId })} className="inline-flex items-center gap-1 hover:text-primary hover:underline">
                            {t("inbox.linked_to")} {active.lead.company || [active.lead.firstName, active.lead.lastName].filter(Boolean).join(" ")}
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">{t("inbox.unlinked")}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {active.leadId ? (
                    <Button size="sm" variant="outline" onClick={() => navigate("lead", { id: active.leadId })}>
                      {t("inbox.open_lead")} <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  ) : (
                    <LinkActions conv={active} />
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
                  <AnimatePresence initial={false}>
                    {activeMessages.map((m: any) => (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}
                      >
                        <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", m.direction === "outbound" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-card border rounded-bl-sm")}>
                          <p className="whitespace-pre-wrap">{m.content}</p>
                          <div className={cn("text-[10px] mt-1 flex items-center gap-1", m.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            <Clock className="h-2.5 w-2.5" />
                            {timeAgo(m.timestamp)}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                <div className="border-t bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Input placeholder="Reply (demo — outbound adapter not connected)…" disabled className="flex-1 bg-background" />
                    <Button size="sm" disabled>Send</Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">{t("inbox.architecture_note")}</p>
                </div>
              </>
            ) : (
              <EmptyState icon={InboxIcon} title={t("inbox.empty")} />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs", accent && value > 0 ? "border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900" : "bg-background")}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", accent && value > 0 && "text-amber-700 dark:text-amber-300")}>{value}</span>
    </div>
  );
}

function LinkActions({ conv }: { conv: any }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<"link" | "create" | null>(null);
  const [search, setSearch] = useState("");
  const leads = useLeads({ q: search, limit: 10 });
  const linkFirst = useLinkMessage(conv.messages[0]?.id ?? "");
  const create = useCreateLeadFromMessage(conv.messages[0]?.id ?? "");

  const doLink = async (leadId: string) => {
    try { await linkFirst.mutateAsync(leadId); toast.success(t("inbox.linked_to")); setMode(null); }
    catch (e) { toast.error((e as Error).message); }
  };
  const doCreate = async () => {
    try { await create.mutateAsync(); toast.success(t("toast.lead_created")); setMode(null); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="flex items-center gap-2">
      {!mode && (
        <>
          <Button size="sm" variant="outline" onClick={() => setMode("link")}><Link2 className="h-3.5 w-3.5 mr-1.5" />{t("inbox.link_to_lead")}</Button>
          <Button size="sm" onClick={() => doCreate()} disabled={create.isPending}><Plus className="h-3.5 w-3.5 mr-1.5" />{t("inbox.create_lead")}</Button>
        </>
      )}
      {mode === "link" && (
        <div className="flex items-center gap-1.5">
          <Input autoFocus placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-44" />
          <Button size="sm" variant="ghost" onClick={() => setMode(null)}>✕</Button>
        </div>
      )}
      {mode === "link" && search.length >= 2 && (
        <div className="absolute z-20 mt-1 right-3 top-12 w-72 rounded-lg border bg-background shadow-lg max-h-60 overflow-y-auto">
          {(leads.data?.rows ?? []).map((l: any) => (
            <button key={l.id} onClick={() => doLink(l.id)} className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-accent text-left transition">
              <LeadAvatar first={l.firstName} last={l.lastName} size={24} />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}</div>
                <div className="text-[11px] text-muted-foreground truncate">{l.company || l.email || l.phone}</div>
              </div>
            </button>
          ))}
          {(leads.data?.rows ?? []).length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground text-center">No leads found</div>}
        </div>
      )}
    </div>
  );
}

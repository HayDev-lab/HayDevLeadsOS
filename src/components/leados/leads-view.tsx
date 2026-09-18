"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeads, useSources, useUsers, usePipeline, useTags, useArchiveLead, useBulkLeads, useRestoreLead, type LeadsQuery } from "@/hooks/leados/use-api";
import { useSavedFilters } from "@/hooks/leados/use-saved-filters";
import { useLocale } from "@/lib/leados/locale";
import { useHashRoute } from "@/lib/leados/hash-route";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Download, Filter, Plus, Search, X, Archive, Upload, Star, Bookmark } from "lucide-react";
import { LeadFormDialog } from "./lead-form-dialog";
import { DuplicatesScanner } from "./duplicates-scanner";
import { ImportDialog } from "./import-dialog";
import { LeadAvatar, OwnerChip, PriorityBadge, ScoreBadge, SourceBadge, StageBadge, timeAgo } from "./primitives";
import { SlaBadge } from "./sla/sla-badge";
import { FollowUpBadge } from "./sla/followup-badge";
import { StageHealthBadge } from "./sla/stage-health-badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DEFAULT_SLA_THRESHOLDS, SLA_STATUS, type SlaThresholds } from "@/lib/sla";
import { DEFAULT_FOLLOWUP_SLA_CONFIG, FOLLOWUP_SLA_STATUS, type FollowUpSlaConfig } from "@/lib/sla-followup";
import { STAGE_INACTIVITY_STATUS, humanizeDuration } from "@/lib/sla-stage-inactivity";

const SLA_SORT_DEFAULT = "sla:priority";

export function LeadsView() {
  const { t } = useLocale();
  const [route, navigate] = useHashRoute();
  const [q, setQ] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [stageId, setStageId] = useState("");
  const [priority, setPriority] = useState<string[]>([]);
  const [overdue, setOverdue] = useState(route.params.overdue === "1");
  const [unassigned, setUnassigned] = useState(false);
  const [slaFilter, setSlaFilter] = useState(route.params.sla === "BREACH" ? "BREACH" : "");
  const [followUpFilter, setFollowUpFilter] = useState(
    route.params.followUp ? String(route.params.followUp).toUpperCase() : ""
  );
  const [stageHealthFilter, setStageHealthFilter] = useState(
    route.params.stageHealth ? String(route.params.stageHealth).toUpperCase() : ""
  );
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(SLA_SORT_DEFAULT);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const savedFilters = useSavedFilters();
  const restore = useRestoreLead();
  const limit = 25;

  // COMMAND PALETTE (v0.19): the "new lead" quick action navigates here and
  // fires `leados:new-lead` — we open the (controlled) create dialog.
  useEffect(() => {
    const fn = () => setNewLeadOpen(true);
    window.addEventListener("leados:new-lead", fn);
    return () => window.removeEventListener("leados:new-lead", fn);
  }, []);

  const sources = useSources();
  const users = useUsers();
  const pipeline = usePipeline();
  const tags = useTags();
  const archive = useArchiveLead();
  const bulk = useBulkLeads();

  // pick initial overdue from route (legacy param — kept for saved filters)
  const query: LeadsQuery = useMemo(() => ({
    q: q || undefined,
    sourceId: sourceId || undefined,
    ownerId: ownerId || undefined,
    stageId: stageId || undefined,
    priority: priority.length ? priority : undefined,
    overdue: overdue || undefined,
    unassigned: unassigned || undefined,
    archived: showArchived || undefined,
    sla: slaFilter || undefined,
    followUp: followUpFilter || undefined,
    stageHealth: stageHealthFilter || undefined,
    page,
    limit,
    sort,
  }), [q, sourceId, ownerId, stageId, priority, overdue, unassigned, showArchived, slaFilter, followUpFilter, stageHealthFilter, page, sort]);

  const leads = useLeads(query);
  const slaConfig: SlaThresholds = leads.data?.slaConfig ?? DEFAULT_SLA_THRESHOLDS;
  const followUpConfig: FollowUpSlaConfig = leads.data?.followUpConfig ?? DEFAULT_FOLLOWUP_SLA_CONFIG;
  const stageInactivityConfig = leads.data?.stageInactivityConfig ?? null;

  const stages = pipeline.data?.pipelines?.[0]?.stages ?? [];

  const togglePriority = (p: string) => setPriority((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  const reset = () => { setQ(""); setSourceId(""); setOwnerId(""); setStageId(""); setPriority([]); setOverdue(false); setUnassigned(false); setSlaFilter(""); setFollowUpFilter(""); setStageHealthFilter(""); setPage(1); };
  const hasFilters = q || sourceId || ownerId || stageId || priority.length || overdue || unassigned || slaFilter || followUpFilter || stageHealthFilter;

  const toggleSelect = (id: string) => setSelected((cur) => {
    const n = new Set(cur);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => {
    const rows = leads.data?.rows ?? [];
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r: any) => r.id)));
  };
  const bulkArchive = async () => {
    try {
      const res = await bulk.mutateAsync({ ids: Array.from(selected), action: "archive" });
      toast.success(`Archived ${res.updated} lead(s)`);
      setSelected(new Set());
    } catch (e) { toast.error((e as Error).message); }
  };
  const bulkAssign = async (ownerId: string) => {
    try {
      const res = await bulk.mutateAsync({ ids: Array.from(selected), action: "assign", ownerId });
      toast.success(`Assigned ${res.updated} lead(s)`);
      setSelected(new Set());
    } catch (e) { toast.error((e as Error).message); }
  };
  const bulkStage = async (stageId: string) => {
    try {
      const res = await bulk.mutateAsync({ ids: Array.from(selected), action: "stage", stageId });
      toast.success(`Moved ${res.updated} lead(s)`);
      setSelected(new Set());
    } catch (e) { toast.error((e as Error).message); }
  };
  const bulkPriority = async (priority: string) => {
    try {
      const res = await bulk.mutateAsync({ ids: Array.from(selected), action: "priority", priority });
      toast.success(`Updated ${res.updated} lead(s)`);
      setSelected(new Set());
    } catch (e) { toast.error((e as Error).message); }
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sourceId) params.set("sourceId", sourceId);
    if (ownerId) params.set("ownerId", ownerId);
    if (stageId) params.set("stageId", stageId);
    if (priority.length) params.set("priority", priority.join(","));
    if (overdue) params.set("overdue", "1");
    if (slaFilter) params.set("sla", slaFilter);
    if (followUpFilter) params.set("followUp", followUpFilter);
    if (stageHealthFilter) params.set("stageHealth", stageHealthFilter);
    window.open(`/api/v1/export?${params.toString()}`, "_blank");
  };

  return (
    <div className="px-4 md:px-6 py-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("leads.title")}</h1>
          <p className="text-sm text-muted-foreground">{leads.data ? `${leads.data.total} total` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <DuplicatesScanner />
          <ImportDialog>
            <Button variant="outline" size="sm"><Upload className="h-4 w-4 mr-1.5" />{t("leads.import")}</Button>
          </ImportDialog>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1.5" />{t("leads.export")}</Button>
          <LeadFormDialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
            <Button size="sm" title="⇧⌘N / Alt+N">
              <Plus className="h-4 w-4 mr-1.5" />{t("leads.new")}
              <span className="ml-2 hidden md:inline-flex items-center gap-0.5 text-[9px] font-medium text-muted-foreground/70 border rounded px-1 py-px">⇧⌘N</span>
            </Button>
          </LeadFormDialog>
        </div>
      </div>

      {/* filters */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder={t("common.search")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Select value={sourceId} onValueChange={(v) => { setSourceId(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder={t("leads.filter.source")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("common.all")}</SelectItem>
              {(sources.data?.rows ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={ownerId} onValueChange={(v) => { setOwnerId(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder={t("leads.filter.owner")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("common.all")}</SelectItem>
              {(users.data?.rows ?? []).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={stageId} onValueChange={(v) => { setStageId(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder={t("leads.filter.stage")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("common.all")}</SelectItem>
              {stages.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
              <button key={p} onClick={() => { togglePriority(p); setPage(1); }} className={cn("h-9 px-2 rounded-md text-xs font-medium border transition", priority.includes(p) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent")}>{p[0]}{p.slice(1).toLowerCase()}</button>
            ))}
          </div>
          <Select value={slaFilter} onValueChange={(v) => { setSlaFilter(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger className={cn("w-40 h-9 text-xs", slaFilter && "border-red-300 dark:border-red-800 font-medium")} aria-label={t("leads.filter.sla")}>
              <SelectValue placeholder={t("leads.filter.sla")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("sla.filter.all")}</SelectItem>
              <SelectItem value={SLA_STATUS.BREACH}>{t("sla.breach")}</SelectItem>
              <SelectItem value={SLA_STATUS.WARNING}>{t("sla.warning")}</SelectItem>
              <SelectItem value={SLA_STATUS.TARGET}>{t("sla.target")}</SelectItem>
              <SelectItem value={SLA_STATUS.RESPONDED}>{t("sla.responded")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={followUpFilter || "__all"} onValueChange={(v) => { setFollowUpFilter(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger
              className={cn("w-40 h-9 text-xs", followUpFilter && followUpFilter === FOLLOWUP_SLA_STATUS.OVERDUE && "border-red-300 dark:border-red-800 font-medium")}
              aria-label={t("followup.filter.label")}
            >
              <SelectValue placeholder={t("followup.filter.label")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("followup.filter.all")}</SelectItem>
              <SelectItem value={FOLLOWUP_SLA_STATUS.OVERDUE}>{t("followup.overdue")}</SelectItem>
              <SelectItem value="TODAY">{t("followup.filter.today")}</SelectItem>
              <SelectItem value={FOLLOWUP_SLA_STATUS.DUE_SOON}>{t("followup.due_soon")}</SelectItem>
              <SelectItem value={FOLLOWUP_SLA_STATUS.SCHEDULED}>{t("followup.scheduled")}</SelectItem>
              <SelectItem value={FOLLOWUP_SLA_STATUS.COMPLETED}>{t("followup.completed")}</SelectItem>
              <SelectItem value="NONE">{t("followup.filter.none")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={stageHealthFilter || "__all"} onValueChange={(v) => { setStageHealthFilter(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger
              className={cn("w-40 h-9 text-xs", stageHealthFilter && stageHealthFilter === STAGE_INACTIVITY_STATUS.STALE && "border-red-300 dark:border-red-800 font-medium")}
              aria-label={t("stage.filter.label")}
            >
              <SelectValue placeholder={t("stage.filter.label")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("stage.filter.all")}</SelectItem>
              <SelectItem value={STAGE_INACTIVITY_STATUS.STALE}>{t("stage.stale")}</SelectItem>
              <SelectItem value={STAGE_INACTIVITY_STATUS.AGING}>{t("stage.aging")}</SelectItem>
              <SelectItem value={STAGE_INACTIVITY_STATUS.ON_TRACK}>{t("stage.on_track")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9 text-xs" aria-label="Sort">
              <SelectValue placeholder={t("sla.sort.priority")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SLA_SORT_DEFAULT}>{t("sla.sort.priority")}</SelectItem>
              <SelectItem value="followup:urgency">{t("followup.sort.urgency")}</SelectItem>
              <SelectItem value="stageinactivity:urgency">{t("stage.sort.urgency")}</SelectItem>
              <SelectItem value="createdAt:desc">{t("common.sort.newest")}</SelectItem>
              <SelectItem value="createdAt:asc">{t("common.sort.oldest")}</SelectItem>
              <SelectItem value="leadScore:desc">{t("common.sort.score")}</SelectItem>
              <SelectItem value="estimatedValue:desc">{t("common.sort.value")}</SelectItem>
            </SelectContent>
          </Select>
          <button onClick={() => { setUnassigned((v) => !v); setPage(1); }} className={cn("h-9 px-3 rounded-md text-xs font-medium border transition flex items-center gap-1.5", unassigned ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300" : "bg-background hover:bg-accent")}>👤 {t("leads.filter.unassigned")}</button>
          <button onClick={() => { setShowArchived((v) => !v); setPage(1); }} className={cn("h-9 px-3 rounded-md text-xs font-medium border transition flex items-center gap-1.5", showArchived ? "bg-zinc-200 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300" : "bg-background hover:bg-accent")}>📦 Archived</button>
          {hasFilters && <Button variant="ghost" size="sm" onClick={reset}><X className="h-3.5 w-3.5 mr-1" />{t("common.clear")}</Button>}
        </div>
        {/* saved filters bar */}
        {(savedFilters.filters.length > 0 || hasFilters) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t">
            <Bookmark className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {savedFilters.filters.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  const q = f.query;
                  setQ((q.q as string) ?? "");
                  setSourceId((q.sourceId as string) ?? "");
                  setOwnerId((q.ownerId as string) ?? "");
                  setStageId((q.stageId as string) ?? "");
                  setPriority((q.priority as string[]) ?? []);
                  setOverdue(!!q.overdue);
                  setUnassigned(!!q.unassigned);
                  setPage(1);
                }}
                className="group inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent transition"
              >
                <Star className="h-3 w-3 text-amber-500" />
                {f.name}
                <span
                  onClick={(e) => { e.stopPropagation(); savedFilters.remove(f.id); }}
                  className="ml-0.5 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                >✕</span>
              </button>
            ))}
            {hasFilters && (
              savePromptOpen ? (
                <div className="inline-flex items-center gap-1.5">
                  <Input
                    autoFocus
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && saveName.trim()) {
                        savedFilters.add(saveName, { q, sourceId, ownerId, stageId, priority, overdue, unassigned });
                        setSaveName(""); setSavePromptOpen(false);
                        toast.success("Filter saved");
                      }
                      if (e.key === "Escape") { setSavePromptOpen(false); setSaveName(""); }
                    }}
                    placeholder="Filter name…"
                    className="h-7 w-32 text-xs"
                  />
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setSavePromptOpen(false); setSaveName(""); }}>✕</Button>
                </div>
              ) : (
                <button
                  onClick={() => setSavePromptOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent transition"
                >
                  <Plus className="h-3 w-3" />Save current
                </button>
              )
            )}
          </div>
        )}
      </Card>

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-primary/5 px-3 py-2.5 text-sm shadow-sm">
          <span className="font-medium flex items-center gap-2">
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">{selected.size}</span>
            selected
          </span>
          <div className="flex flex-wrap gap-2">
            <Select onValueChange={(v) => v !== "__none" && bulkAssign(v)}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Assign to…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {(users.data?.rows ?? []).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select onValueChange={(v) => v !== "__none" && bulkStage(v)}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Move to stage…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {stages.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select onValueChange={(v) => v !== "__none" && bulkPriority(v)}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Priority…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={bulkArchive} disabled={bulk.isPending}><Archive className="h-3.5 w-3.5 mr-1.5" />{t("common.archive")}</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>{t("common.cancel")}</Button>
          </div>
        </div>
      )}

      {/* table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2.5"><input type="checkbox" checked={!!leads.data && selected.size === leads.data.rows.length && leads.data.rows.length > 0} onChange={toggleAll} className="accent-primary" /></th>
                <th className="text-left font-medium px-3 py-2.5 cursor-pointer hover:text-foreground" onClick={() => setSort("createdAt:desc")}>{t("leads.col.lead")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("leads.col.company")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("leads.col.source")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("leads.col.stage")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("leads.col.sla")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("stage.stage_health")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("leads.col.score")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("leads.col.priority")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("leads.col.owner")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("followup.label")}</th>
                <th className="text-left font-medium px-3 py-2.5">{t("leads.col.created")}</th>
                {showArchived && <th className="text-left font-medium px-3 py-2.5">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {leads.isLoading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0"><td colSpan={12} className="px-3"><Skeleton className="h-9 w-full my-1" /></td></tr>
              ))}
              {(leads.data?.rows ?? []).map((l: any) => {
                const overdueAction = l.nextActionAt && new Date(l.nextActionAt).getTime() < Date.now();
                return (
                  <tr key={l.id} className={cn("border-b last:border-0 hover:bg-accent/50 transition cursor-pointer", selected.has(l.id) && "bg-primary/5", l.sla?.isBreached && "bg-red-50/70 dark:bg-red-950/30 hover:bg-red-50 dark:hover:bg-red-950/50", l.stageInactivity?.isStale && !l.sla?.isBreached && "bg-orange-50/60 dark:bg-orange-950/20 hover:bg-orange-50 dark:hover:bg-orange-950/40")} onClick={() => navigate("lead", { id: l.id })}>
                    <td className="px-3 py-2.5" onClick={(e) => { e.stopPropagation(); toggleSelect(l.id); }}><input type="checkbox" checked={selected.has(l.id)} readOnly className="accent-primary" /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <LeadAvatar first={l.firstName} last={l.lastName} color={l.owner?.avatarColor} size={30} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}</div>
                          <div className="text-xs text-muted-foreground truncate">{l.email || l.phone || ""}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 truncate max-w-[220px]" title={l.company || undefined}>{l.company || "—"}</td>
                    <td className="px-3 py-2.5"><SourceBadge name={l.source?.name} type={l.source?.type} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <StageBadge name={l.stage?.name} color={l.stage?.color} type={l.stage?.type} />
                        {l.stageInactivity && l.stageInactivity.status !== "NOT_APPLICABLE" && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {humanizeDuration(l.stageInactivity.stageAgeMinutes)} {t("stage.on_stage")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <SlaBadge createdAt={l.createdAt} firstResponseAt={l.sla?.firstResponseAt ?? null} thresholds={slaConfig} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StageHealthBadge
                        leadStatus={l.status}
                        stageId={l.stageId ?? null}
                        stageName={l.stage?.name}
                        stageType={l.stage?.type}
                        stageEnteredAt={l.stageEnteredAt ?? null}
                        createdAt={l.createdAt}
                        config={stageInactivityConfig}
                        hideNotApplicable
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreBadge score={l.leadScore} category={l.scoreCategory} />
                    </td>
                    <td className="px-3 py-2.5"><PriorityBadge priority={l.priority} /></td>
                    <td className="px-3 py-2.5">{l.owner ? <OwnerChip name={l.owner.name} avatarColor={l.owner.avatarColor} /> : <span className="text-xs text-muted-foreground italic">{t("common.unassigned")}</span>}</td>
                    <td className="px-3 py-2.5">
                      {l.followUp ? (
                        <FollowUpBadge
                          leadStatus={l.status}
                          firstResponseAt={l.sla?.firstResponseAt ?? null}
                          task={
                            l.followUp.taskId
                              ? { id: l.followUp.taskId, title: l.followUp.taskTitle, dueAt: l.followUp.dueAt, createdAt: l.followUp.scheduledAt }
                              : null
                          }
                          lastCompletedAt={l.followUp.completedAt ?? null}
                          config={followUpConfig}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{timeAgo(l.createdAt)}</td>
                    {showArchived && (
                      <td className="px-3 py-2.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); restore.mutate(l.id, { onSuccess: () => toast.success("Lead restored") }); }}
                          disabled={restore.isPending}
                        >↩ Restore</Button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!leads.isLoading && (leads.data?.rows ?? []).length === 0 && (
                <tr><td colSpan={showArchived ? 13 : 12} className="px-6 py-12 text-center text-sm text-muted-foreground">{hasFilters ? "No leads match your filters." : "No leads yet. Create one or import a CSV."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* pagination */}
      {leads.data && leads.data.pages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Page {leads.data.page} of {leads.data.pages} · {leads.data.total} leads</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= leads.data.pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

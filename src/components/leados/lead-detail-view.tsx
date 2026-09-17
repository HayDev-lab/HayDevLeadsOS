"use client";

import { useState } from "react";
import { useLead, useLeadActivities, useLeadNotes, useLeadEvents, useLeadDuplicate, useLeadTasks, useUsers, useUpdateLead, useAssignLead, useArchiveLead, useChangeStage, useLogActivity, useAddNote, useCreateTask, useSyncErp, useMergeLead, useRecalcScore, usePipeline } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { useHashRoute } from "@/lib/leados/hash-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Phone, MessageSquare, Plus, StickyNote, Calendar, Archive, RefreshCw, GitMerge, ExternalLink, AlertTriangle, Zap, Send, CheckCircle2, Clock, FileText, ChevronRight, Sparkles, Brain, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { LeadAvatar, OwnerChip, PriorityBadge, ScoreBadge, StageBadge, StatusPill, SourceBadge, TagChip, formatDate, formatDay, formatMoney, timeAgo } from "./primitives";
import { SlaDetail } from "./sla/sla-detail";
import { FollowUpBadge } from "./sla/followup-badge";
import { FollowUpCard } from "./sla/followup-detail";
import { StageHealthBadge } from "./sla/stage-health-badge";
import { DEFAULT_SLA_THRESHOLDS, type SlaThresholds } from "@/lib/sla";
import { DEFAULT_FOLLOWUP_SLA_CONFIG, FOLLOWUP_SLA_STATUS, followUpQuickDate, humanizeDuration, type FollowUpSlaConfig } from "@/lib/sla-followup";
import { STAGE_INACTIVITY_STATUS } from "@/lib/sla-stage-inactivity";
import { useScheduleFollowUp } from "@/hooks/leados/use-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SCORE_THRESHOLDS } from "@/lib/leados/constants";
import { CustomFieldsPanel } from "./custom-fields-panel";
import { ActivityTimeline } from "./activity-timeline";

export function LeadDetailView({ leadId }: { leadId: string | null }) {
  const { t } = useLocale();
  const [, navigate] = useHashRoute();
  const lead = useLead(leadId);
  const [tab, setTab] = useState("activity");
  const [editOpen, setEditOpen] = useState(false);

  if (!leadId) {
    return <div className="p-6 text-sm text-muted-foreground">No lead selected.</div>;
  }
  if (lead.isLoading) {
    return (
      <div className="px-4 md:px-6 py-5 space-y-4">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-24 w-full" />
        <div className="grid lg:grid-cols-3 gap-4"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>
      </div>
    );
  }
  if (lead.isError || !lead.data) {
    return (
      <div className="p-6 space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("leads")}><ArrowLeft className="h-4 w-4 mr-1.5" />{t("nav.leads")}</Button>
        <p className="text-sm text-muted-foreground">Lead not found or you don't have access.</p>
      </div>
    );
  }

  const l = lead.data.lead;

  return (
    <div className="px-4 md:px-6 py-5 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("leads")} className="text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1.5" />{t("nav.leads")}
      </Button>

      {/* header */}
      <LeadHeader
        lead={l}
        slaThresholds={lead.data?.slaConfig ?? DEFAULT_SLA_THRESHOLDS}
        followUpConfig={lead.data?.followUpConfig ?? DEFAULT_FOLLOWUP_SLA_CONFIG}
        stageInactivityConfig={lead.data?.stageInactivityConfig ?? null}
        onEdit={() => setEditOpen(true)}
      />
      <EditLeadDialog lead={l} open={editOpen} onOpenChange={setEditOpen} />

      {/* duplicate warning */}
      <DuplicateBanner leadId={l.id} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* main */}
        <div className="lg:col-span-2 space-y-4">
          {/* contact + summary */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t("lead.contact_info")}</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Field label={t("common.phone")} value={l.phone} icon={Phone} action={l.phone ? `tel:${l.phone}` : null} />
                <Field label={t("common.email")} value={l.email} icon={Send} action={l.email ? `mailto:${l.email}` : null} />
                <Field label={t("common.company")} value={l.company} />
                <Field label={t("common.source")} value={<SourceBadge name={l.source?.name} type={l.source?.type} />} />
              </div>
              {l.summary && <div className="pt-2 border-t"><p className="text-xs text-muted-foreground mb-1">{t("common.summary")}</p><p className="text-sm">{l.summary}</p></div>}
              {l.requirements && <div className="pt-2 border-t"><p className="text-xs text-muted-foreground mb-1">{t("lead.requirements")}</p><p className="text-sm whitespace-pre-wrap">{l.requirements}</p></div>}
              {l.leadTags?.length > 0 && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1.5">{t("common.tags")}</p>
                  <div className="flex flex-wrap gap-1">{l.leadTags.map((lt: any) => <TagChip key={lt.tag.id} name={lt.tag.name} color={lt.tag.color} />)}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* business audit */}
          {l.audits?.length > 0 && (
            <Card className="border-violet-200 dark:border-violet-900">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4 text-violet-500" />{t("lead.business_audit")}</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-3">
                <AuditScores audit={l.audits[0]} />
                {l.audits[0].reportSummary && <p className="text-xs text-muted-foreground">{l.audits[0].reportSummary}</p>}
                {l.audits[0].priorityAutomations && (
                  <div>
                    <p className="text-xs font-medium mb-1">Priority automations</p>
                    <ul className="text-xs space-y-0.5">{(l.audits[0].priorityAutomations as unknown as string[]).map((a, i) => <li key={i} className="flex items-center gap-1.5"><ChevronRight className="h-3 w-3 text-muted-foreground" />{a}</li>)}</ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* AI summary placeholder (deterministic, feature-flagged) */}
          <Card className="border-dashed">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-muted-foreground" />{t("lead.ai_summary")}</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <AiSummary lead={l} />
            </CardContent>
          </Card>

          {/* custom fields (per-lead editor) */}
          <CustomFieldsPanel leadId={l.id} values={l.customValues ?? []} />

          {/* tabs: activity / tasks / notes / events */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="activity">{t("common.activity")}</TabsTrigger>
              <TabsTrigger value="notes">{t("common.notes")}</TabsTrigger>
              <TabsTrigger value="tasks">{t("common.tasks")}</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>
            <TabsContent value="activity" className="mt-3"><ActivityTab leadId={l.id} /></TabsContent>
            <TabsContent value="notes" className="mt-3"><NotesTab leadId={l.id} /></TabsContent>
            <TabsContent value="tasks" className="mt-3"><TasksTab leadId={l.id} /></TabsContent>
            <TabsContent value="events" className="mt-3"><EventsTab leadId={l.id} /></TabsContent>
          </Tabs>
        </div>

        {/* right panel */}
        <div className="space-y-4">
          <FollowUpCard
            leadId={l.id}
            leadStatus={l.status}
            firstResponseAt={l.sla?.firstResponseAt ?? null}
            task={
              l.followUp?.taskId
                ? { id: l.followUp.taskId, title: l.followUp.taskTitle, dueAt: l.followUp.dueAt, createdAt: l.followUp.scheduledAt }
                : null
            }
            lastCompletedAt={l.followUp?.completedAt ?? null}
            config={lead.data?.followUpConfig ?? DEFAULT_FOLLOWUP_SLA_CONFIG}
          />
          <RightPanel lead={l} />
          <StageChanger lead={l} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, icon: Icon, action }: { label: string; value?: React.ReactNode; icon?: typeof Phone; action?: string | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5 text-sm">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        {value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">—</span>}
        {action && (
          <a href={action} className="ml-auto text-[11px] text-primary hover:underline shrink-0">{action.startsWith("tel") ? "Call" : "Send"}</a>
        )}
      </div>
    </div>
  );
}

function LeadHeader({
  lead: l,
  slaThresholds,
  followUpConfig,
  stageInactivityConfig,
  onEdit,
}: {
  lead: any;
  slaThresholds: SlaThresholds;
  followUpConfig: FollowUpSlaConfig;
  stageInactivityConfig: { warningBeforeHours: number; thresholds: Record<string, number>; usingDefault: string[] } | null;
  onEdit: () => void;
}) {
  const { t } = useLocale();
  const archive = useArchiveLead();
  const sync = useSyncErp(l.id);
  const recalc = useRecalcScore(l.id);
  const [, navigate] = useHashRoute();
  const logActivity = useLogActivity(l.id);

  const quickLog = async (type: string, title: string) => {
    try { await logActivity.mutateAsync({ type, title }); toast.success(title); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          <LeadAvatar first={l.firstName} last={l.lastName} color={l.owner?.avatarColor} size={48} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}</h1>
              <StatusPill status={l.status} />
              <StageBadge name={l.stage?.name} color={l.stage?.color} type={l.stage?.type} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground">{l.company || "—"}</span>
              <SourceBadge name={l.source?.name} type={l.source?.type} />
              <PriorityBadge priority={l.priority} />
              <ScoreBadge score={l.leadScore} category={l.scoreCategory} size="md" />
              {l.owner && <OwnerChip name={l.owner.name} avatarColor={l.owner.avatarColor} />}
            </div>
          </div>
          {l.createdAt && (
            <SlaDetail
              createdAt={l.createdAt}
              firstResponseAt={l.sla?.firstResponseAt ?? null}
              thresholds={slaThresholds}
            />
          )}
          {l.followUp && (
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
          )}
          {l.stageInactivity && (
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
          )}
        </div>
        {/* ATTENTION (Section 70) — compact summary, ONLY when the lead has a
            problem. Empty block is never rendered. */}
        {(() => {
          const issues: string[] = [];
          if (l.sla?.isBreached) issues.push(t("attention.no_first_response"));
          if (l.followUp?.status === FOLLOWUP_SLA_STATUS.OVERDUE) {
            issues.push(`${t("attention.followup_overdue")} · ${humanizeDuration(l.followUp.overdueMinutes ?? 0)}`);
          }
          if (l.stageInactivity?.status === STAGE_INACTIVITY_STATUS.STALE) {
            issues.push(`${t("attention.stage_stale")} · ${humanizeDuration(l.stageInactivity.overdueMinutes ?? 0)}`);
          }
          if (!issues.length) return null;
          return (
            <div role="status" className="mt-3 rounded-lg border border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="font-semibold">{t("attention.title")}:</span>
              <span className="flex flex-wrap gap-x-2">{issues.map((s, i) => <span key={i}>{s}</span>)}</span>
            </div>
          );
        })()}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button size="sm" variant="default" onClick={() => quickLog("CALL", "Call logged")} disabled={logActivity.isPending}><Phone className="h-3.5 w-3.5 mr-1.5" />{t("lead.call")}</Button>
          <Button size="sm" variant="outline" onClick={() => quickLog("MESSAGE", "Message sent")} disabled={logActivity.isPending}><MessageSquare className="h-3.5 w-3.5 mr-1.5" />{t("lead.message")}</Button>
          <Button size="sm" variant="outline" onClick={() => quickLog("EMAIL", "Email sent")} disabled={logActivity.isPending}><Send className="h-3.5 w-3.5 mr-1.5" />Email</Button>
          <Button size="sm" variant="outline" onClick={onEdit}><StickyNote className="h-3.5 w-3.5 mr-1.5" />{t("common.edit")}</Button>
          <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", sync.isPending && "animate-spin")} />{l.integrationSyncs?.some((s: any) => s.status === "SYNCED") ? t("lead.synced_erp") : t("lead.sync_erp")}</Button>
          <Button size="sm" variant="outline" onClick={() => recalc.mutate()} disabled={recalc.isPending}><Zap className="h-3.5 w-3.5 mr-1.5" />{t("common.score")}</Button>
          <Button size="sm" variant="outline" onClick={() => window.open(`/api/v1/leads/${l.id}/export-activity`, "_blank")} title="Export activity timeline as CSV"><Download className="h-3.5 w-3.5 mr-1.5" />Export</Button>
          <Button size="sm" variant="outline" disabled title={t("lead.create_quote.disabled")}><FileText className="h-3.5 w-3.5 mr-1.5" />{t("lead.create_quote")}</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button size="sm" variant="outline"><Archive className="h-3.5 w-3.5 mr-1.5" />{t("common.archive")}</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>{t("common.archive")}?</AlertDialogTitle><AlertDialogDescription>This will soft-archive the lead. History is preserved.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={async () => { await archive.mutateAsync(l.id); toast.success(t("toast.lead_archived")); navigate("leads"); }}>{t("common.archive")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditScores({ audit }: { audit: any }) {
  const { t } = useLocale();
  const scores = [
    { key: "acquisition", label: t("lead.audit.acquisition"), v: audit.acquisition, color: "#0ea5e9" },
    { key: "sales", label: t("lead.audit.sales"), v: audit.sales, color: "#8b5cf6" },
    { key: "operations", label: t("lead.audit.operations"), v: audit.operations, color: "#16a34a" },
    { key: "data", label: t("lead.audit.data"), v: audit.data, color: "#f59e0b" },
    { key: "automation", label: t("lead.audit.automation"), v: audit.automation, color: "#ec4899" },
    { key: "aiReadiness", label: t("lead.audit.ai_readiness"), v: audit.aiReadiness, color: "#14b8a6" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {scores.map((s) => (
        <div key={s.key} className="rounded-lg border bg-card p-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{s.label}</span><span className="font-semibold tabular-nums" style={{ color: s.color }}>{s.v}</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${s.v}%`, backgroundColor: s.color }} /></div>
        </div>
      ))}
    </div>
  );
}

function AiSummary({ lead: l }: { lead: any }) {
  // Deterministic summary — NOT fake AI. Built from lead data.
  const parts: string[] = [];
  if (l.company) parts.push(`manages ${l.company}.`);
  if (l.source?.name) parts.push(`Inquiry came via ${l.source.name}.`);
  if (l.audits?.length) {
    const a = l.audits[0];
    if (a.automation >= 60) parts.push(`Business Audit shows high automation potential (${a.automation}/100).`);
    if (a.aiReadiness >= 70) parts.push(`AI readiness is ${a.aiReadiness}/100.`);
  } else {
    parts.push("No Business Audit completed yet.");
  }
  if (l.owner) parts.push(`Owner: ${l.owner.name}.`);
  if (l.nextActionAt) parts.push(`Next action scheduled.`);
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed">{parts.join(" ")}</p>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Deterministic summary. AI provider is pluggable — no fake AI claims.</p>
    </div>
  );
}

function DuplicateBanner({ leadId }: { leadId: string }) {
  const { t } = useLocale();
  const dup = useLeadDuplicate(leadId);
  const merge = useMergeLead(leadId);
  const [, navigate] = useHashRoute();
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  if (!dup.data?.hasDuplicates) return null;
  const match = dup.data.matches[0];
  return (
    <>
      <Card className="border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/30">
        <CardContent className="py-3 flex items-center gap-3">
          <GitMerge className="h-4 w-4 text-amber-600" />
          <div className="flex-1 text-sm">
            <span className="font-semibold">{t("lead.duplicate_detected")}</span>
            <span className="text-muted-foreground ml-2">{dup.data.matches.length} possible match(es) — matched by {match?.reason}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("lead", { id: match.id })}><ExternalLink className="h-3.5 w-3.5 mr-1" />{t("lead.merge.open_existing")}</Button>
            <Button size="sm" variant="default" onClick={() => setShowMergeDialog(true)}>
              <GitMerge className="h-3.5 w-3.5 mr-1" />{t("lead.merge")}…
            </Button>
          </div>
        </CardContent>
      </Card>
      {showMergeDialog && (
        <MergeDialog leadId={leadId} matchId={match.id} onClose={() => setShowMergeDialog(false)} onMerged={() => { toast.success("Leads merged"); navigate("lead", { id: leadId }); }} />
      )}
    </>
  );
}

function MergeDialog({ leadId, matchId, onClose, onMerged }: { leadId: string; matchId: string; onClose: () => void; onMerged: () => void }) {
  const { t } = useLocale();
  const target = useLead(leadId);
  const source = useLead(matchId);
  const merge = useMergeLead(leadId);
  const [sourceFields, setSourceFields] = useState<Set<string>>(new Set());

  if (target.isLoading || source.isLoading) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;
  const tl = target.data?.lead;
  const sl = source.data?.lead;
  if (!tl || !sl) return null;

  const fields = [
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "company", label: "Company" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "summary", label: "Summary" },
    { key: "requirements", label: "Requirements" },
    { key: "estimatedValue", label: "Est. value" },
    { key: "priority", label: "Priority" },
  ];

  const doMerge = async () => {
    // if user selected source fields, copy them to target first, then merge
    if (sourceFields.size > 0) {
      const patch: Record<string, unknown> = {};
      for (const key of sourceFields) {
        (patch as any)[key] = (sl as any)[key];
      }
      try {
        await fetch(`/api/v1/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } catch {}
    }
    await merge.mutateAsync(matchId);
    onMerged();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitMerge className="h-5 w-5 text-amber-500" />Merge leads</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">The duplicate (source) will be archived. Its activities, tasks, notes, events and tags are moved to this lead. Select fields to copy from the source before merging:</p>
          {/* comparison table */}
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Field</th>
                  <th className="text-left font-medium px-3 py-2">This lead (target)</th>
                  <th className="text-left font-medium px-3 py-2">Duplicate (source)</th>
                  <th className="text-center font-medium px-3 py-2 w-16">Use source</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const targetVal = (tl as any)[f.key];
                  const sourceVal = (sl as any)[f.key];
                  const hasDiff = (targetVal ?? "") !== (sourceVal ?? "");
                  const selected = sourceFields.has(f.key);
                  return (
                    <tr key={f.key} className={cn("border-t", hasDiff && "bg-amber-50/30 dark:bg-amber-950/10")}>
                      <td className="px-3 py-2 font-medium text-muted-foreground">{f.label}</td>
                      <td className="px-3 py-2 truncate max-w-[140px]">{targetVal != null && targetVal !== "" ? String(targetVal) : <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="px-3 py-2 truncate max-w-[140px]">{sourceVal != null && sourceVal !== "" ? String(sourceVal) : <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!hasDiff || sourceVal == null || sourceVal === ""}
                          onChange={(e) => {
                            setSourceFields((cur) => {
                              const n = new Set(cur);
                              if (e.target.checked) n.add(f.key); else n.delete(f.key);
                              return n;
                            });
                          }}
                          className="accent-primary disabled:opacity-30"
                          title={!hasDiff ? "Values are identical" : !sourceVal ? "Source has no value" : "Copy from source"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-bold">{sourceFields.size}</span>
            field(s) will be copied from source before merge
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={doMerge} disabled={merge.isPending} className="bg-amber-600 hover:bg-amber-700 text-white">
            <GitMerge className="h-3.5 w-3.5 mr-1.5" />Merge & archive source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RightPanel({ lead: l }: { lead: any }) {
  const { t } = useLocale();
  const assign = useAssignLead(l.id);
  const users = useUsers();
  const tasks = useLeadTasks(l.id);
  const openTasks = (tasks.data?.rows ?? []).filter((x: any) => x.status !== "DONE" && x.status !== "CANCELLED");
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">{t("lead.open_tasks")} ({openTasks.length})</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-1.5 max-h-48 overflow-y-auto">
          {openTasks.length === 0 && <p className="text-xs text-muted-foreground">No open tasks.</p>}
          {openTasks.map((task: any) => (
            <div key={task.id} className="rounded border p-2 text-xs">
              <div className="font-medium">{task.title}</div>
              <div className="text-muted-foreground flex items-center gap-1 mt-0.5"><Clock className="h-3 w-3" />{task.dueAt ? formatDay(task.dueAt) : "—"}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("common.owner")}</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Select value={l.ownerId ?? "__un"} onValueChange={(v) => { if (v === "__un") return; assign.mutate(v); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__un">{t("common.unassigned")}</SelectItem>
              {(users.data?.rows ?? []).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("lead.score_explanation")}</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-1.5">
          {(l.scoreComponents ?? []).length === 0 && <p className="text-xs text-muted-foreground">No score components yet. Run recalculation.</p>}
          {(l.scoreComponents ?? []).map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={cn("font-semibold tabular-nums", c.delta > 0 ? "text-emerald-600" : "text-red-600")}>{c.delta > 0 ? "+" : ""}{c.delta}</span>
              <span className="flex-1">{c.reason}</span>
            </div>
          ))}
          <div className="pt-1.5 border-t flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t("lead.potential_value")}</span>
            <span className="text-sm font-semibold">{formatMoney(l.estimatedValue)}</span>
          </div>
        </CardContent>
      </Card>

      {l.integrationSyncs?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("erp.sync")}</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1.5 text-xs">
            {l.integrationSyncs.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between">
                <span className="font-mono">{s.externalRefId ?? "—"}</span>
                <span className={cn("px-1.5 py-0.5 rounded font-medium", s.status === "SYNCED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-red-100 text-red-700")}>{s.status}</span>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">Local-mock ERP adapter. Swap in a real provider later.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StageChanger({ lead: l }: { lead: any }) {
  const { t } = useLocale();
  const pipeline = usePipeline();
  const change = useChangeStage(l.id);
  const stages = pipeline.data?.pipelines?.[0]?.stages ?? [];
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{t("lead.change_stage")}</CardTitle></CardHeader>
      <CardContent className="pt-0 grid grid-cols-2 gap-1.5">
        {stages.map((s: any) => (
          <button
            key={s.id}
            onClick={() => change.mutate(s.id)}
            disabled={change.isPending || s.id === l.stageId}
            className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition", s.id === l.stageId ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
            {s.name}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function EditLeadDialog({ lead: l, open, onOpenChange }: { lead: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useLocale();
  const update = useUpdateLead(l.id);
  const [firstName, setFirstName] = useState(l.firstName ?? "");
  const [lastName, setLastName] = useState(l.lastName ?? "");
  const [company, setCompany] = useState(l.company ?? "");
  const [phone, setPhone] = useState(l.phone ?? "");
  const [email, setEmail] = useState(l.email ?? "");
  const [summary, setSummary] = useState(l.summary ?? "");
  const [requirements, setRequirements] = useState(l.requirements ?? "");
  const [estimatedValue, setEstimatedValue] = useState(l.estimatedValue?.toString() ?? "");
  const [priority, setPriority] = useState(l.priority ?? "MEDIUM");
  const [nextActionAt, setNextActionAt] = useState(l.nextActionAt ? new Date(l.nextActionAt).toISOString().slice(0, 16) : "");
  const [nextActionLabel, setNextActionLabel] = useState(l.nextActionLabel ?? "");
  const [lostReason, setLostReason] = useState(l.lostReason ?? "");
  const [lostNotes, setLostNotes] = useState(l.lostNotes ?? "");

  const save = async () => {
    try {
      await update.mutateAsync({
        firstName, lastName, company, phone, email, summary, requirements,
        priority,
        estimatedValue: estimatedValue ? Number(estimatedValue) : null,
        nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : null,
        nextActionLabel: nextActionLabel || null,
        lostReason: lostReason || undefined,
        lostNotes: lostNotes || undefined,
      } as any);
      toast.success(t("toast.lead_updated"));
      onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("common.edit")} · {[l.firstName, l.lastName].filter(Boolean).join(" ")}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1"><Label className="text-xs">First name</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Last name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Company</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Estimated value</Label><Input type="number" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Next action date</Label><Input type="datetime-local" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Next action label</Label><Input value={nextActionLabel} onChange={(e) => setNextActionLabel(e.target.value)} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Summary</Label><Input value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Requirements</Label><Textarea rows={2} value={requirements} onChange={(e) => setRequirements(e.target.value)} /></div>
          {l.status === "LOST" || l.stage?.type === "lost" ? (
            <>
              <div className="space-y-1"><Label className="text-xs">Lost reason</Label><Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Price / Timing / Competitor…" /></div>
              <div className="space-y-1"><Label className="text-xs">Lost notes</Label><Input value={lostNotes} onChange={(e) => setLostNotes(e.target.value)} /></div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={update.isPending}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActivityTab({ leadId }: { leadId: string }) {
  const { t } = useLocale();
  const rows = useLeadActivities(leadId);
  const log = useLogActivity(leadId);
  const scheduleFollowUp = useScheduleFollowUp(leadId);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("NOTE");
  const [thenFollowUp, setThenFollowUp] = useState("");
  if (rows.isLoading) return <Skeleton className="h-40 w-full" />;
  const r = rows.data?.rows ?? [];
  const isQualifying = ["CALL", "MESSAGE", "EMAIL", "MEETING"].includes(type);

  // After logging a qualifying contact, optionally schedule the next follow-up
  // (Section: never forced — the select defaults to "None").
  const submit = async () => {
    if (!title.trim()) return;
    try {
      await log.mutateAsync({ type, title });
      setTitle("");
      if (isQualifying && thenFollowUp) {
        const dueAt = followUpQuickDate(thenFollowUp, DEFAULT_FOLLOWUP_SLA_CONFIG);
        await scheduleFollowUp
          .mutateAsync({ id: leadId, dueAt: dueAt.toISOString() })
          .then(() => toast.success(t("toast.followup_scheduled")))
          .catch(() => {
            // An open follow-up may already exist — the contact itself succeeded.
          });
        setThenFollowUp("");
      }
      toast.success("Activity logged");
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card>
      <CardContent className="p-3">
        {/* quick-log bar */}
        <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{[["CALL", "📞 Call"], ["MESSAGE", "💬 Message"], ["EMAIL", "✉️ Email"], ["MEETING", "📅 Meeting"], ["FOLLOW_UP", "🔔 Follow-up"], ["NOTE", "📝 Note"]].map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="flex-1 min-w-[160px] h-8" placeholder="What happened?" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) submit(); }} />
          {isQualifying && (
            <Select value={thenFollowUp || "__none"} onValueChange={(v) => setThenFollowUp(v === "__none" ? "" : v)}>
              <SelectTrigger className="w-44 h-8 text-xs" aria-label={t("followup.then_follow_up")}>
                <SelectValue placeholder={t("followup.then_follow_up")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{t("followup.none")}</SelectItem>
                <SelectItem value="standard">{t("followup.quick.standard")} · +{DEFAULT_FOLLOWUP_SLA_CONFIG.defaultFollowUpHours}h</SelectItem>
                <SelectItem value="tomorrow">{t("followup.quick.tomorrow")}</SelectItem>
                <SelectItem value="3days">{t("followup.quick.3days")}</SelectItem>
                <SelectItem value="1week">{t("followup.quick.1week")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button size="sm" className="h-8" onClick={submit} disabled={log.isPending || !title.trim()}>{t("common.create")}</Button>
        </div>
        <ActivityTimeline entries={r} />
      </CardContent>
    </Card>
  );
}

function NotesTab({ leadId }: { leadId: string }) {
  const { t } = useLocale();
  const rows = useLeadNotes(leadId);
  const add = useAddNote(leadId);
  const [content, setContent] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  if (rows.isLoading) return <Skeleton className="h-40 w-full" />;
  const r = rows.data?.rows ?? [];
  const submit = async () => {
    if (!content.trim()) return;
    try { await add.mutateAsync(content); setContent(""); toast.success(t("toast.note_added")); } catch (e) { toast.error((e as Error).message); }
  };
  const insertMd = (before: string, after: string = "") => {
    const ta = document.getElementById("note-textarea") as HTMLTextAreaElement;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = content.substring(start, end) || "text";
    const newText = content.substring(0, start) + before + sel + after + content.substring(end);
    setContent(newText);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + before.length, start + before.length + sel.length); }, 0);
  };
  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        {/* markdown toolbar */}
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => insertMd("**", "**")} className="h-7 w-7 rounded text-xs font-bold hover:bg-accent border" title="Bold">B</button>
          <button onClick={() => insertMd("*", "*")} className="h-7 w-7 rounded text-xs italic hover:bg-accent border" title="Italic">I</button>
          <button onClick={() => insertMd("`", "`")} className="h-7 w-7 rounded text-xs font-mono hover:bg-accent border" title="Code">{`<>`}</button>
          <button onClick={() => insertMd("- ")} className="h-7 px-2 rounded text-xs hover:bg-accent border" title="Bullet list">• List</button>
          <button onClick={() => insertMd("## ")} className="h-7 px-2 rounded text-xs hover:bg-accent border" title="Heading">H</button>
          <button onClick={() => insertMd("[", "](url)")} className="h-7 px-2 rounded text-xs hover:bg-accent border" title="Link">🔗</button>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setShowPreview(false)} className={cn("h-7 px-2 rounded text-xs", !showPreview ? "bg-primary text-primary-foreground" : "hover:bg-accent border")}>Write</button>
            <button onClick={() => setShowPreview(true)} className={cn("h-7 px-2 rounded text-xs", showPreview ? "bg-primary text-primary-foreground" : "hover:bg-accent border")}>Preview</button>
          </div>
        </div>
        {showPreview ? (
          <div className="min-h-[60px] rounded-lg border p-3 prose prose-sm dark:prose-invert max-w-none">
            <MarkdownPreview content={content} />
          </div>
        ) : (
          <Textarea id="note-textarea" rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Add a note… (markdown supported)" className="font-mono text-sm" />
        )}
        <Button size="sm" onClick={submit} disabled={add.isPending || !content.trim()} className="self-end">{t("common.save")}</Button>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {r.length === 0 && <p className="text-xs text-muted-foreground">No notes.</p>}
          {r.map((n: any) => (
            <div key={n.id} className="rounded-lg border p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium flex items-center gap-1.5"><LeadAvatar first={n.user?.name} size={18} />{n.user?.name ?? "System"}</span>
                <span className="text-[11px] text-muted-foreground">{formatDate(n.createdAt)}</span>
              </div>
              <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                <MarkdownPreview content={n.content} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return <ReactMarkdown>{content}</ReactMarkdown>;
}

function TasksTab({ leadId }: { leadId: string }) {
  const { t } = useLocale();
  const rows = useLeadTasks(leadId);
  const create = useCreateTask(leadId);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  if (rows.isLoading) return <Skeleton className="h-40 w-full" />;
  const r = rows.data?.rows ?? [];
  const submit = async () => {
    if (!title.trim()) return;
    try { await create.mutateAsync({ title, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined } as any); setTitle(""); setDueAt(""); toast.success(t("toast.task_created")); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[160px] space-y-1"><Label className="text-xs">Task</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" /></div>
          <div className="space-y-1"><Label className="text-xs">Due</Label><Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div>
          <Button size="sm" onClick={submit} disabled={create.isPending || !title.trim()}>{t("common.create")}</Button>
        </div>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {r.length === 0 && <p className="text-xs text-muted-foreground">{t("tasks.empty")}</p>}
          {r.map((task: any) => (
            <div key={task.id} className="flex items-center gap-2 rounded-lg border p-2">
              {task.status === "DONE" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
              <span className={cn("text-sm flex-1", task.status === "DONE" && "line-through text-muted-foreground")}>{task.title}</span>
              <PriorityBadge priority={task.priority} />
              {task.dueAt && <span className="text-xs text-muted-foreground">{formatDay(task.dueAt)}</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EventsTab({ leadId }: { leadId: string }) {
  const rows = useLeadEvents(leadId);
  if (rows.isLoading) return <Skeleton className="h-40 w-full" />;
  const r = rows.data?.rows ?? [];
  return (
    <Card>
      <CardContent className="p-3">
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {r.length === 0 && <p className="text-xs text-muted-foreground">No events.</p>}
          {r.map((e: any) => (
            <div key={e.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
              <span className="font-mono px-1.5 py-0.5 rounded bg-muted text-[10px]">{e.type}</span>
              <span className="text-muted-foreground">{e.user?.name ?? "system"}</span>
              <span className="ml-auto text-muted-foreground">{formatDate(e.createdAt)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

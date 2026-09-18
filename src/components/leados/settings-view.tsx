"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSettings, useTags, useSources, useUsers, usePipeline, useIngestAudit, useCustomFields, useCreateCustomField, useDeleteCustomField, useCreateStage, useUpdateStage, useDeleteStage, useAssignmentRules, useCreateAssignmentRule, useUpdateAssignmentRule, useDeleteAssignmentRule, useWebhookEvents, useWebhookEndpoints, useCreateWebhookEndpoint, useDeleteWebhookEndpoint, useTestWebhookEndpoint } from "@/hooks/leados/use-api";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "@/lib/leados/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Input as TextInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { FORECAST_SETTING_KEY, readForecastThreshold } from "@/lib/leados/forecast-config";
import { Badge } from "@/components/ui/badge";
import { Brain, Check, Plus, RefreshCw, Save, Sparkles, Webhook, Trash2, Settings2, GripVertical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LeadAvatar, formatDate, timeAgo } from "./primitives";
import { SlaConfigTab } from "./sla-config-tab";
import { NotificationsTab } from "./notifications/settings-notifications-tab";
import { IntegrationsTab } from "./settings/integrations-tab";
import { WorkersTab } from "./settings/workers-tab";
import { ProfileTab } from "./settings/profile-tab";
import { TeamTab } from "./settings/team-tab";
import { SecurityAuditTab } from "./settings/security-audit-tab";
import { useSession } from "@/hooks/leados/use-api";

// v0.17: centralized permission constants (client mirror — the SERVER
// enforces the real checks; the UI only hides what a role cannot use).
import { PERMISSIONS } from "@/lib/leados/auth/permissions";

export function SettingsView({ initialTab }: { initialTab?: string }) {
  const { t } = useLocale();
  const settings = useSettings();
  const session = useSession();
  const [tab, setTab] = useState(initialTab ?? "profile");

  const perms = session.data?.session?.permissions ?? [];
  const can = (p: string) => perms.includes(p);
  const canOrg = can(PERMISSIONS.ORG_SETTINGS_MANAGE);

  if (settings.isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="px-4 md:px-6 py-5 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{settings.data?.org?.name} · {settings.data?.org?.slug}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto gap-0.5 py-1 justify-start">
          <TabsTrigger value="profile">{t("settings.profile")}</TabsTrigger>
          <TabsTrigger value="team">{t("settings.team")}</TabsTrigger>
          {canOrg && <TabsTrigger value="org">{t("settings.organization")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="pipeline">{t("settings.pipeline")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="sources">{t("settings.sources")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="tags">{t("settings.tags")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="custom">{t("settings.custom_fields")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="scoring">{t("settings.scoring")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="sla">SLA</TabsTrigger>}
          <TabsTrigger value="notifications">{t("notif.settings.title")}</TabsTrigger>
          {can(PERMISSIONS.INTEGRATION_MANAGE) && <TabsTrigger value="integrations">{t("settings.integrations")}</TabsTrigger>}
          {can(PERMISSIONS.WORKER_HEALTH_READ) && <TabsTrigger value="workers">{t("settings.workers")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="rules">{t("settings.rules")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="auditingest">{t("settings.audit_ingest")}</TabsTrigger>}
          {can(PERMISSIONS.AUDIT_READ) && <TabsTrigger value="security">{t("settings.security")}</TabsTrigger>}
          {canOrg && <TabsTrigger value="erp">{t("settings.erp")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile" className="mt-4"><ProfileTab /></TabsContent>
        <TabsContent value="team" className="mt-4"><TeamTab /></TabsContent>
        {canOrg && <TabsContent value="org" className="mt-4"><OrgTab /></TabsContent>}
        {canOrg && <TabsContent value="pipeline" className="mt-4"><PipelineTab /></TabsContent>}
        {canOrg && <TabsContent value="sources" className="mt-4"><SourcesTab /></TabsContent>}
        {canOrg && <TabsContent value="tags" className="mt-4"><TagsTab /></TabsContent>}
        {canOrg && <TabsContent value="custom" className="mt-4"><CustomFieldsTab /></TabsContent>}
        {canOrg && <TabsContent value="scoring" className="mt-4"><ScoringTab /></TabsContent>}
        {canOrg && <TabsContent value="sla" className="mt-4"><SlaConfigTab /></TabsContent>}
        <TabsContent value="notifications" className="mt-4"><NotificationsTab /></TabsContent>
        {can(PERMISSIONS.INTEGRATION_MANAGE) && <TabsContent value="integrations" className="mt-4"><IntegrationsTab /></TabsContent>}
        {can(PERMISSIONS.WORKER_HEALTH_READ) && <TabsContent value="workers" className="mt-4"><WorkersTab /></TabsContent>}
        {canOrg && <TabsContent value="rules" className="mt-4"><AssignmentRulesTab /></TabsContent>}
        {canOrg && <TabsContent value="auditingest" className="mt-4"><AuditIngestTab /></TabsContent>}
        {can(PERMISSIONS.AUDIT_READ) && <TabsContent value="security" className="mt-4"><SecurityAuditTab /></TabsContent>}
        {canOrg && <TabsContent value="erp" className="mt-4"><ErpTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

function OrgTab() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const org = settings.data?.org;
  const [name, setName] = useState(org?.name ?? "");
  const [locale, setLocale] = useState(org?.locale ?? "hy");
  const [timezone, setTimezone] = useState(org?.timezone ?? "Asia/Yerevan");
  const [currency, setCurrency] = useState(org?.currency ?? "AMD");
  // v0.23: org-configurable forecast commit threshold (Setting row, default 60).
  // Derived-value pattern: `savedThreshold` comes straight from the settings
  // query; `thresholdOverride` only exists while the slider is being dragged
  // (or until save+refetch lands) — no effect/ref syncing needed.
  const savedThreshold = settings.data ? readForecastThreshold(settings.data.settings) : 60;
  const [thresholdOverride, setThresholdOverride] = useState<number | null>(null);
  const commitThreshold = thresholdOverride ?? savedThreshold;
  const save = async () => {
    try {
      const res = await fetch("/api/v1/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org: { name, locale, timezone, currency } }) });
      if (res.ok) toast.success(t("toast.saved")); else toast.error(t("toast.save_failed"));
      settings.refetch();
    } catch { toast.error(t("toast.save_failed")); }
  };
  const saveThreshold = async (value: number) => {
    try {
      const res = await fetch("/api/v1/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: FORECAST_SETTING_KEY, value }) });
      if (res.ok) {
        toast.success(t("toast.saved"));
        // Analytics (forecast) is React-Query cached — refetch it so the new
        // threshold shows up the next time the Analytics view opens.
        queryClient.invalidateQueries({ queryKey: ["analytics"] });
        // Refetch settings so `savedThreshold` absorbs the new value, then
        // drop the override (no flicker: the override holds until data lands).
        await settings.refetch();
        setThresholdOverride(null);
      } else {
        // save rejected — snap the slider back to the persisted value
        setThresholdOverride(null);
        toast.error(t("toast.save_failed"));
      }
    } catch {
      setThresholdOverride(null);
      toast.error(t("toast.save_failed"));
    }
  };
  if (settings.isLoading || !org) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-4 max-w-xl">
      <Card><CardContent className="p-4 grid grid-cols-2 gap-3">
        <div className="space-y-1 col-span-2"><Label className="text-xs">{t("settings.org.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">{t("settings.org.locale")}</Label>
          <Select value={locale} onValueChange={setLocale}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["hy", "ru", "en"].map((l) => <SelectItem key={l} value={l}>{l === "hy" ? "Հայերեն" : l === "ru" ? "Русский" : "English"}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">{t("settings.org.timezone")}</Label><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">{t("settings.org.currency")}</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
        <div className="col-span-2"><Button size="sm" onClick={save}><Save className="h-3.5 w-3.5 mr-1.5" />{t("common.save")}</Button></div>
      </CardContent></Card>
      {/* v0.23: forecast commit threshold (was hardcoded 60% in analytics-service) */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <Label className="text-xs">{t("settings.org.forecast_commit")}</Label>
            <span className="text-sm font-bold tabular-nums text-primary">{commitThreshold}%</span>
          </div>
          <Slider
            value={[commitThreshold]}
            min={10}
            max={95}
            step={5}
            onValueChange={(v: number[]) => setThresholdOverride(v[0] ?? 60)}
            onValueCommit={(v: number[]) => saveThreshold(v[0] ?? 60)}
            aria-label={t("settings.org.forecast_commit")}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("settings.org.forecast_commit_hint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function PipelineTab() {
  const { t } = useLocale();
  const settings = useSettings();
  const createStage = useCreateStage();
  const updateStage = useUpdateStage();
  const delStage = useDeleteStage();
  const [newStage, setNewStage] = useState<{ name: string; type: string; color: string }>({ name: "", type: "open", color: "#94a3b8" });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (settings.isLoading) return <Skeleton className="h-48 w-full" />;
  const pipelines = settings.data?.pipelines ?? [];

  const addStage = async (pipelineId: string) => {
    if (!newStage.name.trim()) return;
    try {
      await createStage.mutateAsync({ pipelineId, name: newStage.name, type: newStage.type, color: newStage.color });
      toast.success(t("toast.stage_added"));
      setNewStage({ name: "", type: "open", color: "#94a3b8" });
    } catch (e) { toast.error((e as Error).message); }
  };
  const renameStage = async (id: string, name: string) => {
    try { await updateStage.mutateAsync({ id, body: { name } }); } catch (e) { toast.error((e as Error).message); }
  };
  const recolorStage = async (id: string, color: string) => {
    try { await updateStage.mutateAsync({ id, body: { color } }); } catch (e) { toast.error((e as Error).message); }
  };
  const removeStage = async (id: string) => {
    try { await delStage.mutateAsync(id); toast.success(t("toast.stage_deleted")); } catch (e) { toast.error((e as Error).message); }
  };
  const onDragEnd = async (pipelineId: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const p = pipelines.find((pp: any) => pp.id === pipelineId);
    if (!p) return;
    const oldIndex = p.stages.findIndex((s: any) => s.id === active.id);
    const newIndex = p.stages.findIndex((s: any) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(p.stages as any[], oldIndex, newIndex) as any[];
    // persist new positions
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].position !== i) {
        try { await updateStage.mutateAsync({ id: reordered[i].id, body: { position: i } }); } catch {}
      }
    }
    toast.success(t("toast.stages_reordered"));
  };

  return (
    <div className="space-y-3">
      {pipelines.map((p: any) => (
        <Card key={p.id}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{p.name}</CardTitle>
            {p.isDefault && <Badge>{t("settings.pipeline.default")}</Badge>}
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd(p.id, e)}>
              <SortableContext items={p.stages.map((s: any) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {p.stages.map((s: any) => (
                    <SortableStage
                      key={s.id}
                      stage={s}
                      onRecolor={recolorStage}
                      onRename={renameStage}
                      onRemove={removeStage}
                      updating={updateStage.isPending}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {/* add new stage */}
            <div className="flex items-center gap-2 pt-1 border-t">
              <input
                type="color"
                value={newStage.color}
                onChange={(e) => setNewStage((s) => ({ ...s, color: e.target.value }))}
                className="h-6 w-6 rounded cursor-pointer border-0 bg-transparent p-0"
              />
              <Input
                value={newStage.name}
                onChange={(e) => setNewStage((s) => ({ ...s, name: e.target.value }))}
                placeholder={t("settings.pipeline.new_stage")}
                className="h-8 flex-1 text-sm"
              />
              <Select value={newStage.type} onValueChange={(v) => setNewStage((s) => ({ ...s, type: v }))}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{t("settings.pipeline.type_open")}</SelectItem>
                  <SelectItem value="won">{t("settings.pipeline.type_won")}</SelectItem>
                  <SelectItem value="lost">{t("settings.pipeline.type_lost")}</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => addStage(p.id)} disabled={!newStage.name.trim() || createStage.isPending}>
                <Plus className="h-3.5 w-3.5 mr-1" />{t("common.create")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground px-1 flex items-center gap-1.5">
        <GripVertical className="h-3 w-3" />
        {t("settings.pipeline.hint")}
      </p>
    </div>
  );
}

function SortableStage({ stage, onRecolor, onRename, onRemove, updating }: { stage: any; onRecolor: (id: string, c: string) => void; onRename: (id: string, n: string) => void; onRemove: (id: string) => void; updating: boolean }) {
  const { t } = useLocale();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : "auto",
  };
  return (
    <div ref={setNodeRef} style={style} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-card", isDragging && "shadow-lg ring-2 ring-primary/30 opacity-90")}>
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none" title={t("settings.pipeline.drag_title")}>
        <GripVertical className="h-4 w-4" />
      </button>
      <input
        type="color"
        value={stage.color ?? "#94a3b8"}
        onChange={(e) => onRecolor(stage.id, e.target.value)}
        className="h-6 w-6 rounded cursor-pointer border-0 bg-transparent p-0"
        title={t("settings.pipeline.color_title")}
      />
      <input
        defaultValue={stage.name}
        onBlur={(e) => { if (e.target.value !== stage.name) onRename(stage.id, e.target.value); }}
        className="flex-1 bg-transparent text-sm font-medium outline-none border-b border-transparent focus:border-primary"
      />
      <Badge variant="outline" className="text-[10px] px-1 py-0">{stage.type}</Badge>
      {updating && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      <button
        onClick={() => onRemove(stage.id)}
        className="text-muted-foreground hover:text-red-500 text-xs px-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        title={t("settings.pipeline.delete_title")}
        aria-label={t("settings.pipeline.delete_title")}
      >✕</button>
    </div>
  );
}

function SourcesTab() {
  const { t } = useLocale();
  const sources = useSources();
  return (
    <Card><CardContent className="p-0 divide-y">
      {(sources.data?.rows ?? []).map((s: any) => (
        <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors">
          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{s.type}</span>
          <span className="font-medium flex-1">{s.name}</span>
          {s.isSystem && <Badge variant="secondary" className="text-[10px]">{t("settings.sources.system")}</Badge>}
          <Badge variant={s.active ? "default" : "outline"} className="text-[10px]">{s.active ? t("settings.sources.active") : t("settings.sources.off")}</Badge>
        </div>
      ))}
    </CardContent></Card>
  );
}

function TagsTab() {
  const tags = useTags();
  return (
    <Card><CardContent className="p-4 flex flex-wrap gap-2">
      {(tags.data?.rows ?? []).map((tag: any) => (
        <span key={tag.id} className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color ?? "#64748b" }} />
          {tag.name}
        </span>
      ))}
    </CardContent></Card>
  );
}

function ScoringTab() {
  const { t } = useLocale();
  const settings = useSettings();
  const [rules, setRules] = useState<any[]>([]);
  // local copy once loaded
  useState(() => { if (settings.data?.scoring) setRules(settings.data.scoring); });
  if (settings.isLoading) return <Skeleton className="h-48 w-full" />;
  const list = rules.length ? rules : settings.data?.scoring ?? [];
  const update = (idx: number, patch: Partial<any>) => setRules((cur) => cur.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const save = async () => {
    try {
      const res = await fetch("/api/v1/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scoring: list.map((r: any) => ({ key: r.key, points: r.points, enabled: r.enabled })) }) });
      if (res.ok) toast.success(t("toast.scoring_saved")); else toast.error(t("toast.save_failed"));
      settings.refetch();
    } catch { toast.error(t("toast.save_failed")); }
  };
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        {list.map((r: any, i: number) => (
          <div key={r.key} className="flex items-center gap-2">
            <button onClick={() => update(i, { enabled: !r.enabled })} aria-pressed={r.enabled} className={cn("h-5 w-5 rounded flex items-center justify-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", r.enabled ? "bg-primary border-primary text-primary-foreground" : "bg-background hover:border-muted-foreground/40")}><Check className="h-3 w-3" /></button>
            <span className="flex-1 text-sm">{r.label}</span>
            <Input type="number" value={r.points} onChange={(e) => update(i, { points: Number(e.target.value) })} className="w-20" />
            <span className="text-xs text-muted-foreground">{t("settings.scoring.pts")}</span>
          </div>
        ))}
        <Button size="sm" onClick={save}><Save className="h-3.5 w-3.5 mr-1.5" />{t("settings.scoring.save")}</Button>
      </CardContent>
    </Card>
  );
}

function AuditIngestTab() {
  const { t } = useLocale();
  const ingest = useIngestAudit();
  const [payload, setPayload] = useState(JSON.stringify({
    companyName: "Demo Co",
    contactName: "Narek Test",
    contactEmail: "narek@democo.am",
    contactPhone: "+37499123456",
    locale: "hy",
    scores: { acquisition: 60, sales: 50, operations: 70, data: 55, automation: 65, aiReadiness: 75 },
    reportSummary: "Audit completed — high automation potential",
  }, null, 2));
  const submit = async () => {
    try {
      const parsed = JSON.parse(payload);
      const r = await ingest.mutateAsync(parsed);
      toast.success(t("settings.audit.toast", { id: r.leadId, status: r.created ? t("settings.audit.status_new") : t("settings.audit.status_updated") }));
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4 text-violet-500" />{t("settings.audit.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("settings.audit.desc")}</p>
        <Textarea rows={12} value={payload} onChange={(e) => setPayload(e.target.value)} className="font-mono text-xs" />
        <Button size="sm" onClick={submit} disabled={ingest.isPending}><RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", ingest.isPending && "animate-spin")} />{t("settings.audit.ingest")}</Button>
      </CardContent>
    </Card>
  );
}

function ErpTab() {
  const { t } = useLocale();
  const settings = useSettings();
  if (settings.isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4" />{t("settings.erp.events_title")}</CardTitle></CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {t("settings.erp.events_desc")}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {["lead.created", "lead.assigned", "lead.stage_changed", "lead.qualified", "lead.won", "lead.lost", "task.created", "task.overdue", "audit.completed"].map((e) => (
              <Badge key={e} variant="outline" className="font-mono text-[10px]">{e}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><RefreshCw className="h-4 w-4" />{t("settings.erp.adapter_title")}</CardTitle></CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          <p>{t("settings.erp.adapter_desc")}</p>
        </CardContent>
      </Card>
      <WebhookEventsTab />
      <WebhookEndpointsTab />
    </div>
  );
}

function CustomFieldsTab() {
  const { t } = useLocale();
  const fields = useCustomFields();
  const create = useCreateCustomField();
  const del = useDeleteCustomField();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");

  const submit = async () => {
    if (!name.trim() || !key.trim()) return;
    try {
      const opts = type === "select" || type === "multiselect"
        ? options.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      await create.mutateAsync({ name, key, type, options: opts });
      toast.success(t("toast.field_created"));
      setName(""); setKey(""); setType("text"); setOptions("");
    } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (id: string) => {
    try { await del.mutateAsync(id); toast.success(t("toast.field_deleted")); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Settings2 className="h-4 w-4" />{t("settings.custom_fields")}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground mb-3">{t("settings.custom_fields.hint")}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("custom.name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Industry" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("custom.key")}</Label>
              <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="industry" className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("custom.type")}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">{t("custom.text")}</SelectItem>
                  <SelectItem value="number">{t("custom.number")}</SelectItem>
                  <SelectItem value="select">{t("custom.select")}</SelectItem>
                  <SelectItem value="date">{t("custom.date")}</SelectItem>
                  <SelectItem value="bool">{t("custom.bool")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("custom.options")}</Label>
              <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Construction, Retail,…" disabled={type !== "select" && type !== "multiselect"} />
            </div>
          </div>
          <Button size="sm" onClick={submit} disabled={create.isPending || !name.trim() || !key.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />{t("custom.create")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 divide-y">
          {(fields.data?.rows ?? []).length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("settings.custom.empty")}</div>
          )}
          {(fields.data?.rows ?? []).map((f: any) => {
            const opts = Array.isArray(f.options) ? f.options : [];
            return (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{f.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{f.key}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{f.type}</Badge>
                  </div>
                  {opts.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {opts.map((o: string) => <span key={o} className="text-[10px] px-1.5 py-0.5 rounded bg-muted">{o}</span>)}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => remove(f.id)} className="text-muted-foreground hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignmentRulesTab() {
  const { t } = useLocale();
  const rules = useAssignmentRules();
  const users = useUsers();
  const sources = useSources();
  const create = useCreateAssignmentRule();
  const update = useUpdateAssignmentRule();
  const del = useDeleteAssignmentRule();
  const [newRule, setNewRule] = useState<{ name: string; sourceType: string; priority: string; assigneeId: string }>({ name: "", sourceType: "", priority: "", assigneeId: "" });

  const addRule = async () => {
    if (!newRule.name.trim() || !newRule.assigneeId) return;
    try {
      await create.mutateAsync({
        name: newRule.name,
        sourceType: newRule.sourceType || null,
        priority: newRule.priority || null,
        assigneeId: newRule.assigneeId,
        enabled: true,
      });
      toast.success(t("toast.rule_created"));
      setNewRule({ name: "", sourceType: "", priority: "", assigneeId: "" });
    } catch (e) { toast.error((e as Error).message); }
  };
  const toggleRule = async (id: string, enabled: boolean) => {
    try { await update.mutateAsync({ id, body: { enabled } }); } catch (e) { toast.error((e as Error).message); }
  };
  const removeRule = async (id: string) => {
    try { await del.mutateAsync(id); toast.success(t("toast.rule_deleted")); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Settings2 className="h-4 w-4" />{t("settings.rules")}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground mb-3">{t("settings.rules.desc")}</p>
          {(rules.data?.rows ?? []).length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("settings.rules.empty")}</div>
          )}
          <div className="space-y-1.5">
            {(rules.data?.rows ?? []).map((r: any) => (
              <div key={r.id} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 transition", !r.enabled && "opacity-50")}>
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-muted text-[10px] font-bold">{r.position + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1.5">
                    {r.sourceType && <Badge variant="outline" className="text-[9px] px-1 py-0">{t("settings.rules.source")}: {r.sourceType}</Badge>}
                    {r.priority && <Badge variant="outline" className="text-[9px] px-1 py-0">{t("settings.rules.priority")}: {r.priority}</Badge>}
                    <span className="flex items-center gap-1">→ <LeadAvatar first={r.assignee?.name} color={r.assignee?.avatarColor} size={16} /> {r.assignee?.name}</span>
                  </div>
                </div>
                <button
                  onClick={() => toggleRule(r.id, !r.enabled)}
                  role="switch"
                  aria-checked={r.enabled}
                  className={cn("relative h-5 w-9 rounded-full transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1", r.enabled ? "bg-primary" : "bg-muted")}
                  title={r.enabled ? t("settings.rules.disable") : t("settings.rules.enable")}
                >
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform", r.enabled ? "translate-x-4" : "translate-x-0.5")} />
                </button>
                <button onClick={() => removeRule(r.id)} className="text-muted-foreground hover:text-red-500 text-xs px-1 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" title={t("settings.rules.delete_title")} aria-label={t("settings.rules.delete_title")}>✕</button>
              </div>
            ))}
          </div>
          {/* add new rule */}
          <div className="mt-3 pt-3 border-t space-y-2">
            <div className="text-xs font-medium text-muted-foreground">{t("settings.rules.add")}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Input value={newRule.name} onChange={(e) => setNewRule((s) => ({ ...s, name: e.target.value }))} placeholder={t("settings.rules.name_ph")} className="h-8 text-sm" />
              <Select value={newRule.sourceType || "__any"} onValueChange={(v) => setNewRule((s) => ({ ...s, sourceType: v === "__any" ? "" : v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("settings.rules.any_source")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">{t("settings.rules.any_source")}</SelectItem>
                  {(sources.data?.rows ?? []).map((s: any) => <SelectItem key={s.id} value={s.type}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={newRule.priority || "__any"} onValueChange={(v) => setNewRule((s) => ({ ...s, priority: v === "__any" ? "" : v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("settings.rules.any_priority")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">{t("settings.rules.any_priority")}</SelectItem>
                  <SelectItem value="LOW">{t("priority.low")}</SelectItem>
                  <SelectItem value="MEDIUM">{t("priority.medium")}</SelectItem>
                  <SelectItem value="HIGH">{t("priority.high")}</SelectItem>
                  <SelectItem value="URGENT">{t("priority.urgent")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={newRule.assigneeId} onValueChange={(v) => setNewRule((s) => ({ ...s, assigneeId: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("settings.rules.assignee_ph")} /></SelectTrigger>
                <SelectContent>
                  {(users.data?.rows ?? []).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={addRule} disabled={!newRule.name.trim() || !newRule.assigneeId || create.isPending}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />{t("common.create")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WebhookEventsTab() {
  const { t } = useLocale();
  const events = useWebhookEvents(undefined, 50);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4" />{t("settings.erp.webhooks_title")}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground mb-3">{t("settings.erp.webhooks_desc")}</p>
        {events.data?.byEvent && Object.keys(events.data.byEvent).length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {Object.entries(events.data.byEvent).map(([ev, count]) => (
              <Badge key={ev} variant="outline" className="font-mono text-[10px]">{ev}: {count as number}</Badge>
            ))}
          </div>
        )}
        <div className="max-h-80 overflow-y-auto space-y-1">
          {(events.data?.rows ?? []).map((e: any) => (
            <div key={e.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", e.published ? "bg-emerald-500" : "bg-muted-foreground")} />
              <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted">{e.event}</span>
              {e.lead && <span className="text-muted-foreground truncate">{e.lead.company || [e.lead.firstName, e.lead.lastName].filter(Boolean).join(" ")}</span>}
              <span className="ml-auto text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {(events.data?.rows ?? []).length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("settings.erp.no_events")}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function WebhookEndpointsTab() {
  const { t } = useLocale();
  const endpoints = useWebhookEndpoints();
  const create = useCreateWebhookEndpoint();
  const del = useDeleteWebhookEndpoint();
  const test = useTestWebhookEndpoint();
  const [newEp, setNewEp] = useState<{ name: string; url: string; events: string }>({ name: "", url: "", events: "*" });
  const [testingId, setTestingId] = useState<string | null>(null);

  const addEndpoint = async () => {
    if (!newEp.name.trim() || !newEp.url.trim()) return;
    try {
      await create.mutateAsync({ name: newEp.name, url: newEp.url, events: newEp.events || "*", enabled: true });
      toast.success(t("toast.endpoint_registered"));
      setNewEp({ name: "", url: "", events: "*" });
    } catch (e) { toast.error((e as Error).message); }
  };
  const removeEp = async (id: string) => {
    try { await del.mutateAsync(id); toast.success(t("toast.endpoint_deleted")); } catch (e) { toast.error((e as Error).message); }
  };
  const testEp = async (id: string) => {
    setTestingId(id);
    try {
      const res = await test.mutateAsync(id);
      if (res.ok) toast.success(t("settings.erp.test_ok", { status: res.status ?? "?" }));
      else toast.error(t("settings.erp.test_fail", { error: res.error ?? "—" }));
    } catch (e) { toast.error((e as Error).message); }
    finally { setTestingId(null); }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4" />{t("settings.erp.endpoints_title")}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground mb-3">{t("settings.erp.endpoints_desc")}</p>
        {(endpoints.data?.rows ?? []).length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t("settings.erp.no_endpoints")}</div>
        )}
        <div className="space-y-1.5 mb-3">
          {(endpoints.data?.rows ?? []).map((ep: any) => (
            <div key={ep.id} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2", !ep.enabled && "opacity-50")}>
              <span title={ep.enabled ? String(ep.lastStatus ?? "—") : t("settings.sources.off")} className={cn("h-2 w-2 rounded-full shrink-0", ep.enabled ? (ep.lastStatus === "FAILED" ? "bg-red-500" : ep.lastStatus === "OK" ? "bg-emerald-500" : "bg-muted-foreground") : "bg-muted-foreground")} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{ep.name}</div>
                <div className="text-[11px] text-muted-foreground truncate font-mono">{ep.url}</div>
              </div>
              <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">{ep.events}</Badge>
              {ep.failCount > 0 && <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-600 border-red-300">{t("settings.erp.fail_count", { n: ep.failCount })}</Badge>}
              {ep.lastDeliveryAt && <span className="text-[10px] text-muted-foreground shrink-0">{new Date(ep.lastDeliveryAt).toLocaleDateString()}</span>}
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => testEp(ep.id)} disabled={testingId === ep.id}>
                {testingId === ep.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t("settings.erp.test")}
              </Button>
              <button onClick={() => removeEp(ep.id)} className="text-muted-foreground hover:text-red-500 text-xs px-1 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" title={t("settings.erp.delete_title")} aria-label={t("settings.erp.delete_title")}>✕</button>
            </div>
          ))}
        </div>
        {/* add new endpoint */}
        <div className="pt-3 border-t space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{t("settings.erp.register")}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input value={newEp.name} onChange={(e) => setNewEp((s) => ({ ...s, name: e.target.value }))} placeholder={t("settings.erp.name_ph")} className="h-8 text-sm" />
            <Input value={newEp.url} onChange={(e) => setNewEp((s) => ({ ...s, url: e.target.value }))} placeholder="https://…" className="h-8 text-sm font-mono" />
            <Input value={newEp.events} onChange={(e) => setNewEp((s) => ({ ...s, events: e.target.value }))} placeholder={t("settings.erp.events_ph")} className="h-8 text-sm font-mono" />
          </div>
          <Button size="sm" onClick={addEndpoint} disabled={!newEp.name.trim() || !newEp.url.trim() || create.isPending}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />{t("common.create")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

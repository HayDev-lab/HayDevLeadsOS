"use client";

import { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSettings, useTags, useSources, useUsers, usePipeline, useIngestAudit, useCustomFields, useCreateCustomField, useDeleteCustomField, useCreateStage, useUpdateStage, useDeleteStage } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Input as TextInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Brain, Check, Plus, RefreshCw, Save, Sparkles, Webhook, Trash2, Settings2, GripVertical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LeadAvatar, formatDate, timeAgo } from "./primitives";

export function SettingsView() {
  const { t } = useLocale();
  const settings = useSettings();
  const [tab, setTab] = useState("org");

  if (settings.isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="px-4 md:px-6 py-5 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{settings.data?.org?.name} · {settings.data?.org?.slug}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="org">{t("settings.organization")}</TabsTrigger>
          <TabsTrigger value="users">{t("settings.users")}</TabsTrigger>
          <TabsTrigger value="pipeline">{t("settings.pipeline")}</TabsTrigger>
          <TabsTrigger value="sources">{t("settings.sources")}</TabsTrigger>
          <TabsTrigger value="tags">{t("settings.tags")}</TabsTrigger>
          <TabsTrigger value="custom">{t("settings.custom_fields")}</TabsTrigger>
          <TabsTrigger value="scoring">{t("settings.scoring")}</TabsTrigger>
          <TabsTrigger value="audit">Audit Ingest</TabsTrigger>
          <TabsTrigger value="erp">ERP / Events</TabsTrigger>
        </TabsList>
        <TabsContent value="org" className="mt-4"><OrgTab /></TabsContent>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="pipeline" className="mt-4"><PipelineTab /></TabsContent>
        <TabsContent value="sources" className="mt-4"><SourcesTab /></TabsContent>
        <TabsContent value="tags" className="mt-4"><TagsTab /></TabsContent>
        <TabsContent value="custom" className="mt-4"><CustomFieldsTab /></TabsContent>
        <TabsContent value="scoring" className="mt-4"><ScoringTab /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditIngestTab /></TabsContent>
        <TabsContent value="erp" className="mt-4"><ErpTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function OrgTab() {
  const settings = useSettings();
  const org = settings.data?.org;
  const [name, setName] = useState(org?.name ?? "");
  const [locale, setLocale] = useState(org?.locale ?? "hy");
  const [timezone, setTimezone] = useState(org?.timezone ?? "Asia/Yerevan");
  const [currency, setCurrency] = useState(org?.currency ?? "AMD");
  const save = async () => {
    try {
      const res = await fetch("/api/v1/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org: { name, locale, timezone, currency } }) });
      if (res.ok) toast.success("Saved"); else toast.error("Save failed");
      settings.refetch();
    } catch { toast.error("Save failed"); }
  };
  if (settings.isLoading || !org) return <Skeleton className="h-48 w-full" />;
  return (
    <Card><CardContent className="p-4 grid grid-cols-2 gap-3 max-w-xl">
      <div className="space-y-1 col-span-2"><Label className="text-xs">Organization name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label className="text-xs">Locale</Label>
        <Select value={locale} onValueChange={setLocale}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["hy", "ru", "en"].map((l) => <SelectItem key={l} value={l}>{l === "hy" ? "Հայերեն" : l === "ru" ? "Русский" : "English"}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="space-y-1"><Label className="text-xs">Timezone</Label><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></div>
      <div className="space-y-1"><Label className="text-xs">Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
      <div className="col-span-2"><Button size="sm" onClick={save}><Save className="h-3.5 w-3.5 mr-1.5" />Save</Button></div>
    </CardContent></Card>
  );
}

function UsersTab() {
  const users = useUsers();
  if (users.isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <Card>
      <CardContent className="p-0 divide-y">
        {(users.data?.rows ?? []).map((u: any) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3">
            <LeadAvatar first={u.name} color={u.avatarColor} size={32} />
            <div className="flex-1 min-w-0"><div className="text-sm font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email} · {u.title || "—"}</div></div>
            <Badge variant="outline" className="text-xs">{u.role}</Badge>
            <Badge variant="secondary" className="text-xs">{u.status}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
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
      toast.success("Stage added");
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
    try { await delStage.mutateAsync(id); toast.success("Stage deleted"); } catch (e) { toast.error((e as Error).message); }
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
    toast.success("Stages reordered");
  };

  return (
    <div className="space-y-3">
      {pipelines.map((p: any) => (
        <Card key={p.id}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{p.name}</CardTitle>
            {p.isDefault && <Badge>Default</Badge>}
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
                placeholder="New stage name…"
                className="h-8 flex-1 text-sm"
              />
              <Select value={newStage.type} onValueChange={(v) => setNewStage((s) => ({ ...s, type: v }))}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">open</SelectItem>
                  <SelectItem value="won">won</SelectItem>
                  <SelectItem value="lost">lost</SelectItem>
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
        Drag the handle to reorder · rename inline · recolor via swatch · delete (blocked if leads are in the stage). Changes reflect immediately in the Kanban.
      </p>
    </div>
  );
}

function SortableStage({ stage, onRecolor, onRename, onRemove, updating }: { stage: any; onRecolor: (id: string, c: string) => void; onRename: (id: string, n: string) => void; onRemove: (id: string) => void; updating: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : "auto",
  };
  return (
    <div ref={setNodeRef} style={style} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-card", isDragging && "shadow-lg ring-2 ring-primary/30 opacity-90")}>
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none" title="Drag to reorder">
        <GripVertical className="h-4 w-4" />
      </button>
      <input
        type="color"
        value={stage.color ?? "#94a3b8"}
        onChange={(e) => onRecolor(stage.id, e.target.value)}
        className="h-6 w-6 rounded cursor-pointer border-0 bg-transparent p-0"
        title="Stage color"
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
        className="text-muted-foreground hover:text-red-500 text-xs px-1"
        title="Delete stage"
      >✕</button>
    </div>
  );
}

function SourcesTab() {
  const sources = useSources();
  return (
    <Card><CardContent className="p-0 divide-y">
      {(sources.data?.rows ?? []).map((s: any) => (
        <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{s.type}</span>
          <span className="font-medium flex-1">{s.name}</span>
          {s.isSystem && <Badge variant="secondary" className="text-[10px]">system</Badge>}
          <Badge variant={s.active ? "default" : "outline"} className="text-[10px]">{s.active ? "active" : "off"}</Badge>
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
      if (res.ok) toast.success("Scoring saved"); else toast.error("Save failed");
      settings.refetch();
    } catch { toast.error("Save failed"); }
  };
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        {list.map((r: any, i: number) => (
          <div key={r.key} className="flex items-center gap-2">
            <button onClick={() => update(i, { enabled: !r.enabled })} className={cn("h-5 w-5 rounded flex items-center justify-center border", r.enabled ? "bg-primary border-primary text-primary-foreground" : "bg-background")}><Check className="h-3 w-3" /></button>
            <span className="flex-1 text-sm">{r.label}</span>
            <Input type="number" value={r.points} onChange={(e) => update(i, { points: Number(e.target.value) })} className="w-20" />
            <span className="text-xs text-muted-foreground">pts</span>
          </div>
        ))}
        <Button size="sm" onClick={save}><Save className="h-3.5 w-3.5 mr-1.5" />Save scoring</Button>
      </CardContent>
    </Card>
  );
}

function AuditIngestTab() {
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
      toast.success(`Audit ingested → lead ${r.leadId} (${r.created ? "new" : "updated"})`);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4 text-violet-500" />Business Audit Ingestion</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">POST /api/v1/business-audit — accepts a completed audit payload, creates/updates the matching lead, attaches the audit, recomputes the score.</p>
        <Textarea rows={12} value={payload} onChange={(e) => setPayload(e.target.value)} className="font-mono text-xs" />
        <Button size="sm" onClick={submit} disabled={ingest.isPending}><RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", ingest.isPending && "animate-spin")} />Ingest audit</Button>
      </CardContent>
    </Card>
  );
}

function ErpTab() {
  const settings = useSettings();
  if (settings.isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4" />Integration Events (published)</CardTitle></CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          LeadOS publishes these events for the future Automation Engine / Owner AI:
          <div className="flex flex-wrap gap-1.5 mt-2">
            {["lead.created", "lead.assigned", "lead.stage_changed", "lead.qualified", "lead.won", "lead.lost", "task.created", "task.overdue", "audit.completed"].map((e) => (
              <Badge key={e} variant="outline" className="font-mono text-[10px]">{e}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><RefreshCw className="h-4 w-4" />ERP Adapter</CardTitle></CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          <p>Provider: <code className="font-mono">HAYDEV_ERP</code> (local-mock). Sync status is tracked per lead. Swap in a real provider by implementing the <code>ErpAdapter</code> interface — no fake production claims.</p>
        </CardContent>
      </Card>
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
      toast.success("Custom field created");
      setName(""); setKey(""); setType("text"); setOptions("");
    } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (id: string) => {
    try { await del.mutateAsync(id); toast.success("Field deleted"); } catch (e) { toast.error((e as Error).message); }
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
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No custom fields yet. Add one above — it becomes available on every lead without migrations.</div>
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

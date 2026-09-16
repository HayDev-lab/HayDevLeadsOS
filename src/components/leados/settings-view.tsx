"use client";

import { useState } from "react";
import { useSettings, useTags, useSources, useUsers, usePipeline, useIngestAudit } from "@/hooks/leados/use-api";
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
import { Brain, Check, Plus, RefreshCw, Save, Sparkles, Webhook } from "lucide-react";
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
          <TabsTrigger value="scoring">{t("settings.scoring")}</TabsTrigger>
          <TabsTrigger value="audit">Audit Ingest</TabsTrigger>
          <TabsTrigger value="erp">ERP / Events</TabsTrigger>
        </TabsList>
        <TabsContent value="org" className="mt-4"><OrgTab /></TabsContent>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="pipeline" className="mt-4"><PipelineTab /></TabsContent>
        <TabsContent value="sources" className="mt-4"><SourcesTab /></TabsContent>
        <TabsContent value="tags" className="mt-4"><TagsTab /></TabsContent>
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
  const settings = useSettings();
  if (settings.isLoading) return <Skeleton className="h-48 w-full" />;
  const pipelines = settings.data?.pipelines ?? [];
  return (
    <div className="space-y-3">
      {pipelines.map((p: any) => (
        <Card key={p.id}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between"><CardTitle className="text-sm">{p.name}</CardTitle>{p.isDefault && <Badge>Default</Badge>}</CardHeader>
          <CardContent className="pt-0 flex flex-wrap gap-1.5">
            {p.stages.map((s: any) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
                {s.name}
                <Badge variant="outline" className="text-[10px] px-1 py-0">{s.type}</Badge>
              </span>
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground px-1">Pipeline and stages are seeded. Full CRUD config UI is part of the remaining 20%.</p>
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

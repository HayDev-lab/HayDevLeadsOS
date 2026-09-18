"use client";

// META LEAD ADS — connector card for Settings → Lead Sources (v0.19).
//
// Disconnected: one [Connect Meta] action (demo deployments get the demo
// connect — zero network). Connected: pages with subscription state, forms
// with mapping management, health, failed events with manual retry, test
// mapping (dry) + test lead (full chain), disconnect.
//
// Styling: existing shadcn/ui primitives + the LeadOS design language
// (Cards, Badges, Selects, Switch, Dialog). NO giant single component —
// the card is split into focused sections below.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, useSources, useUsers, usePipeline } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Facebook, RefreshCw, Plug, PlugZap, Wrench, Trash2, Loader2, Send, FlaskConical, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetaStatus {
  connected: boolean;
  connection: { status: string; appMode: string; displayName: string | null; lastLeadAt: string | null; tokenExpiresAt: string | null } | null;
  pages: Array<{ pageId: string; pageName: string | null; subscriptionStatus: string; subscriptionError: string | null; lastWebhookAt: string | null; lastLeadAt: string | null }>;
  forms: Array<{ formId: string; formName: string | null; status: string; active: boolean; leadSourceId: string | null; defaultOwnerId: string | null; defaultStageId: string | null; mapping: unknown; lastLeadAt: string | null }>;
  health: { failedEvents: number; lastSuccessfulLeadAt: string | null; tokenStatus: string; pagesSubscribed: number; pagesTotal: number; activeForms: number; unmappedForms: number };
  failedEvents: Array<{ id: string; status: string; attempts: number; lastErrorCode: string | null; receivedAt: string; formId: string; pageId: string }>;
}

function useMetaStatus() {
  return useQuery({
    queryKey: ["meta-status"],
    queryFn: () => api.get<MetaStatus>("/integrations/meta/status"),
    retry: false,
    refetchInterval: 30_000,
  });
}

export function MetaLeadAdsCard() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const status = useMetaStatus();

  const connect = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ ok: boolean; authorizeUrl?: string }>("/integrations/meta/connect");
      return res;
    },
    onSuccess: (res) => {
      if (res.authorizeUrl) window.location.href = res.authorizeUrl;
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const connectDemo = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/integrations/meta/connect-demo"),
    onSuccess: () => {
      toast.success(t("meta.toast.connected_demo"));
      qc.invalidateQueries({ queryKey: ["meta-status"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status.isLoading) return <Card><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>;

  const s = status.data;
  const connected = s?.connected;
  const reauth = s?.connection?.status === "REAUTH_REQUIRED";
  const demo = s?.connection?.appMode === "DEMO";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Facebook className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            {t("meta.title")}
            {demo && <Badge variant="secondary" className="text-[10px]">DEMO</Badge>}
          </span>
          {connected && <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">{t("meta.connected")}</Badge>}
          {reauth && <Badge variant="destructive" className="text-[10px]">{t("meta.reauth_required")}</Badge>}
          {!connected && !reauth && <Badge variant="outline" className="text-[10px]">{t("meta.disconnected")}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {!connected && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("meta.desc")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => connectDemo.mutate()} disabled={connectDemo.isPending}>
                {connectDemo.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5 mr-1.5" />}
                {t("meta.connect_demo")}
              </Button>
              <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plug className="h-3.5 w-3.5 mr-1.5" />}
                {t("meta.connect")}
              </Button>
            </div>
          </div>
        )}
        {(connected || reauth) && s && (
          <>
            <MetaHealthRow s={s} />
            <MetaPagesSection s={s} />
            <MetaFormsSection s={s} />
            <MetaFailedEvents s={s} />
            <MetaTestSection s={s} />
            <div className="flex justify-end pt-1">
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void disconnectMeta(qc, t)}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />{t("meta.disconnect")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

async function disconnectMeta(qc: ReturnType<typeof useQueryClient>, t: (k: never) => string) {
  try {
    await api.post("/integrations/meta/disconnect");
    toast.success(t("meta.toast.disconnected" as never));
    qc.invalidateQueries({ queryKey: ["meta-status"] });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

function MetaHealthRow({ s }: { s: MetaStatus }) {
  const { t } = useLocale();
  const h = s.health;
  return (
    <div className="flex flex-wrap gap-1.5 text-[10px]">
      <Badge variant="outline" className={cn("gap-1", h.tokenStatus === "OK" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
        {h.tokenStatus === "OK" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        {t("meta.health.token")}: {h.tokenStatus}
      </Badge>
      <Badge variant="outline">{t("meta.health.pages")}: {h.pagesSubscribed}/{h.pagesTotal}</Badge>
      <Badge variant="outline">{t("meta.health.forms")}: {h.activeForms} · {t("meta.health.unmapped")}: {h.unmappedForms}</Badge>
      {h.failedEvents > 0 && <Badge variant="outline" className="text-red-600 border-red-300 dark:text-red-400">{t("meta.health.failed")}: {h.failedEvents}</Badge>}
      {h.lastSuccessfulLeadAt && <Badge variant="outline">{t("meta.health.last_lead")}: {new Date(h.lastSuccessfulLeadAt).toLocaleString()}</Badge>}
    </div>
  );
}

function MetaPagesSection({ s }: { s: MetaStatus }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [busyPage, setBusyPage] = useState<string | null>(null);
  const repair = async (pageId: string) => {
    setBusyPage(pageId);
    try {
      await api.post("/integrations/meta/pages/repair", { pageId });
      toast.success(t("meta.toast.subscription_repaired"));
      qc.invalidateQueries({ queryKey: ["meta-status"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyPage(null);
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{t("meta.pages")}</div>
      {s.pages.map((p) => (
        <div key={p.pageId} className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{p.pageName ?? p.pageId}</div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">{p.pageId}</div>
          </div>
          <Badge variant="outline" className={cn("text-[9px]",
            p.subscriptionStatus === "SUBSCRIBED" ? "text-emerald-700 border-emerald-300 dark:text-emerald-400" :
            p.subscriptionStatus === "ERROR" ? "text-red-600 border-red-300" : "text-muted-foreground")}>
            {p.subscriptionStatus}
          </Badge>
          {p.lastWebhookAt && <span className="text-[10px] text-muted-foreground">{t("meta.page.last_webhook")}: {new Date(p.lastWebhookAt).toLocaleDateString()}</span>}
          {p.subscriptionStatus !== "SUBSCRIBED" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => repair(p.pageId)} disabled={busyPage === p.pageId}>
              {busyPage === p.pageId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}
              {t("meta.page.repair")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

const FIELD_TARGETS = ["firstName", "lastName", "email", "phone", "company", "position", "METADATA", "IGNORE"] as const;

function MetaFormsSection({ s }: { s: MetaStatus }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const sources = useSources();
  const users = useUsers();
  const pipeline = usePipeline();
  const [mappingForm, setMappingForm] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.post<{ discovered: number }>("/integrations/meta/forms/refresh");
      toast.success(t("meta.toast.forms_refreshed", { n: r.discovered }));
      qc.invalidateQueries({ queryKey: ["meta-status"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const stages = (pipeline.data?.pipelines?.[0]?.stages ?? []) as Array<{ id: string; name: string }>;
  const form = s.forms.find((f) => f.formId === mappingForm);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">{t("meta.forms")}</div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          {t("meta.forms.refresh")}
        </Button>
      </div>
      {s.forms.length === 0 && <div className="text-xs text-muted-foreground px-1 py-2">{t("meta.forms.empty")}</div>}
      {s.forms.map((f) => (
        <div key={f.formId} className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 transition", !f.active && "opacity-70")}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{f.formName ?? f.formId}</div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              {f.formId}
              {f.lastLeadAt ? ` · ${t("meta.form.last_lead")}: ${new Date(f.lastLeadAt).toLocaleDateString()}` : ""}
            </div>
          </div>
          {f.active
            ? <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[9px]">{t("meta.form.mapped")}</Badge>
            : <Badge variant="outline" className="text-[9px] text-amber-700 dark:text-amber-400">{t("meta.form.unmapped")}</Badge>}
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setMappingForm(f.formId)}>
            {t("meta.form.manage")}
          </Button>
        </div>
      ))}

      {form && (
        <MappingDialog
          form={form}
          stages={stages}
          sources={(sources.data?.rows ?? []) as Array<{ id: string; name: string }>}
          users={(users.data?.rows ?? []) as Array<{ id: string; name: string }>}
          onClose={() => setMappingForm(null)}
        />
      )}
    </div>
  );
}

interface MappingRuleUI { metaField: string; target: string }

function MappingDialog({ form, stages, sources, users, onClose }: {
  form: NonNullable<MetaStatus["forms"][number]>;
  stages: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [active, setActive] = useState(form.active);
  const [leadSourceId, setLeadSourceId] = useState(form.leadSourceId ?? "");
  const [defaultOwnerId, setDefaultOwnerId] = useState(form.defaultOwnerId ?? "");
  const [defaultStageId, setDefaultStageId] = useState(form.defaultStageId ?? "");
  const [rules, setRules] = useState<MappingRuleUI[]>(() => {
    const raw = Array.isArray(form.mapping) ? (form.mapping as MappingRuleUI[]) : [];
    return raw.length ? raw : [];
  });
  const [preview, setPreview] = useState<{ leadFields: Record<string, string>; metadata: Record<string, string>; initialNote: string | null } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Default known-field rules for a fresh mapping (backend mapper is the
  // source of truth — these rows are just persisted configuration).
  const defaultRules: MappingRuleUI[] = [
    { metaField: "full_name", target: "firstName" },
    { metaField: "email", target: "email" },
    { metaField: "phone_number", target: "phone" },
    { metaField: "company_name", target: "company" },
  ];
  const effectiveRules = rules.length ? rules : defaultRules;

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/integrations/meta/forms/mapping", {
        formId: form.formId,
        active,
        leadSourceId: leadSourceId || null,
        defaultOwnerId: defaultOwnerId || null,
        defaultStageId: defaultStageId || null,
        mapping: effectiveRules,
      });
      toast.success(t("meta.toast.mapping_saved"));
      qc.invalidateQueries({ queryKey: ["meta-status"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const testMapping = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ preview: { leadFields: Record<string, string>; metadata: Record<string, string>; initialNote: string | null } }>("/integrations/meta/forms/test-mapping", {
        rules: effectiveRules,
        formName: form.formName,
      });
      setPreview(r.preview);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{t("meta.mapping.title")} — {form.formName}</DialogTitle>
          <DialogDescription className="text-xs">{t("meta.mapping.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>{t("meta.mapping.active")}</span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-primary" />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">{t("meta.mapping.source")}</div>
              <Select value={leadSourceId || "__none"} onValueChange={(v) => setLeadSourceId(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {sources.map((src) => <SelectItem key={src.id} value={src.id}>{src.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">{t("meta.mapping.owner")}</div>
              <Select value={defaultOwnerId || "__none"} onValueChange={(v) => setDefaultOwnerId(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">{t("meta.mapping.stage")}</div>
              <Select value={defaultStageId || "__none"} onValueChange={(v) => setDefaultStageId(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {stages.map((st) => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground">{t("meta.mapping.fields")}</div>
            {effectiveRules.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted min-w-0 truncate flex-1">{r.metaField}</span>
                <span className="text-muted-foreground text-[10px]">→</span>
                <Select value={r.target} onValueChange={(v) => setRules((cur) => {
                  const next = cur.length ? [...cur] : defaultRules.map((x) => ({ ...x }));
                  next[i] = { ...next[i], target: v };
                  return next;
                })}>
                  <SelectTrigger className="h-7 w-36 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TARGETS.map((target) => <SelectItem key={target} value={target}>{t(`meta.mapping.target.${target === "METADATA" ? "metadata" : target === "IGNORE" ? "ignore" : target}` as never)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">{t("meta.mapping.hint")}</p>
          </div>

          {preview && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
              <div className="text-[10px] font-medium text-muted-foreground">{t("meta.mapping.preview")}</div>
              <div className="text-xs">
                {Object.entries(preview.leadFields).map(([k, v]) => (
                  <div key={k} className="flex gap-2"><span className="text-muted-foreground min-w-20">{k}:</span><span className="font-medium truncate">{v}</span></div>
                ))}
                {preview.initialNote && <div className="text-[10px] text-muted-foreground mt-1 whitespace-pre-line line-clamp-4">{preview.initialNote}</div>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button size="sm" variant="outline" onClick={testMapping} disabled={testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5 mr-1.5" />}
            {t("meta.mapping.test")}
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaFailedEvents({ s }: { s: MetaStatus }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  if (!s.failedEvents.length) return null;
  const retry = async (eventId: string) => {
    try {
      await api.post("/integrations/meta/retry", { eventId });
      toast.success(t("meta.toast.requeued"));
      qc.invalidateQueries({ queryKey: ["meta-status"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        {t("meta.events.title")} ({s.failedEvents.length})
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border p-1.5">
        {s.failedEvents.map((ev) => (
          <div key={ev.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-[10px]">
            <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 shrink-0">{ev.status}</Badge>
            <span className="font-mono text-muted-foreground shrink-0">{ev.lastErrorCode ?? "—"}</span>
            <span className="text-muted-foreground truncate">{t("meta.events.attempts")}: {ev.attempts}</span>
            <span className="text-muted-foreground shrink-0 ml-auto">{new Date(ev.receivedAt).toLocaleString()}</span>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] shrink-0" onClick={() => retry(ev.id)}>
              <RefreshCw className="h-2.5 w-2.5 mr-1" />{t("meta.events.retry")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetaTestSection({ s }: { s: MetaStatus }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const activeForms = s.forms.filter((f) => f.active);
  if (!activeForms.length) return null;

  const sendTestLead = async () => {
    setSending(true);
    try {
      const r = await api.post<{ leadgenId: string; worker: { completed: number; deduplicated: number } }>("/integrations/meta/test-lead", {
        formId: activeForms[0].formId,
      });
      toast.success(t("meta.toast.test_lead", {
        n: r.worker.completed + r.worker.deduplicated,
      }));
      qc.invalidateQueries({ queryKey: ["meta-status"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{t("meta.test.desc")}</div>
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs shrink-0" onClick={sendTestLead} disabled={sending}>
        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
        {t("meta.test.send")}
      </Button>
    </div>
  );
}

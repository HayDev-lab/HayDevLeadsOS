"use client";

// SETTINGS → INTEGRATIONS (v0.16 spec 40, 90–96, 98, 101).
// Three channel cards — Email / Telegram / Webhook:
//   • status: Connected | Demo (simulated) | Not configured | Error;
//   • test actions (spec 94–96): test email / test message / test webhook —
//     synthetic only, never a real Lead event;
//   • webhook endpoint CRUD with SSRF-validated URLs (spec 54) + auto-secret;
//   • secrets NEVER come back from the server (spec 89, 101).
// Demo mode shows an honest banner: external sends are SIMULATED (spec 99).

import { useState } from "react";
import { Mail, MessageCircle, Webhook as WebhookIcon, Plus, Plug, PlugZap, Send, Trash2, ShieldCheck, FlaskConical } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useLocale } from "@/lib/leados/locale";
import {
  useIntegrationsStatus,
  useTestEmail,
  useTelegramStatus,
  useTelegramConnect,
  useTelegramConnectDemo,
  useTelegramDisconnect,
  useTelegramTest,
  useCreateIntegrationWebhook,
  useUpdateIntegrationWebhook,
  useDeleteIntegrationWebhook,
  useTestIntegrationWebhook,
} from "@/hooks/leados/use-api";
import type { DictKey } from "@/lib/leados/i18n";
import { timeAgo } from "../primitives";

function ModeBadge({ mode, t }: { mode: string; t: (k: DictKey) => string }) {
  if (mode === "DEMO") return <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700 dark:text-amber-300"><FlaskConical className="h-3 w-3" />{t("integr.mode.demo")}</Badge>;
  if (mode === "REAL") return <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-3 w-3" />{t("integr.mode.real")}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{t("integr.mode.unavailable")}</Badge>;
}

export function IntegrationsTab() {
  const { t } = useLocale();
  const status = useIntegrationsStatus();
  const endpoints = (status.data?.webhookEndpoints ?? []) as { id: string; name: string; url: string; enabled: boolean; events: string; lastDeliveryAt: string | null; lastStatus: string | null }[];
  const telegram = useTelegramStatus();
  const testEmail = useTestEmail();
  const telegramConnect = useTelegramConnect();
  const telegramConnectDemo = useTelegramConnectDemo();
  const telegramDisconnect = useTelegramDisconnect();
  const telegramTest = useTelegramTest();
  const createWebhook = useCreateIntegrationWebhook();
  const updateWebhook = useUpdateIntegrationWebhook();
  const deleteWebhook = useDeleteIntegrationWebhook();
  const testWebhook = useTestIntegrationWebhook();

  const [connectCode, setConnectCode] = useState<string | null>(null);
  const [demoChatId, setDemoChatId] = useState("");
  const [showDemoConnect, setShowDemoConnect] = useState(false);
  const [newEp, setNewEp] = useState({ name: "", url: "", events: "*" });

  if (status.isLoading) return <Skeleton className="h-96 w-full" />;
  const ch = status.data?.channels;
  const isDemo = ch?.email.mode === "DEMO" || ch?.telegram.mode === "DEMO" || ch?.webhook.mode === "DEMO";

  const onTestEmail = async () => {
    const r = await testEmail.mutateAsync();
    if (r.ok) toast.success(t("integr.email.test_ok"));
    else toast.error(r.error ?? t("integr.email.test_fail"));
  };

  const onTestTelegram = async () => {
    const r = await telegramTest.mutateAsync();
    if (r.ok) toast.success(t("integr.telegram.test_ok"));
    else toast.error(r.error ?? t("integr.telegram.test_fail"));
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {isDemo && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200">
          {t("integr.demo_banner")}
        </div>
      )}

      {/* EMAIL */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" /> {t("integr.email.title")}</CardTitle>
          <ModeBadge mode={ch?.email.mode ?? "UNAVAILABLE"} t={t} />
        </CardHeader>
        <CardContent className="space-y-2.5">
          <p className="text-xs text-muted-foreground">{t("integr.email.desc")}</p>
          {ch?.email.from && <p className="text-xs"><span className="text-muted-foreground">{t("integr.email.from")}:</span> {ch.email.from}</p>}
          <Button size="sm" variant="outline" onClick={onTestEmail} disabled={testEmail.isPending || ch?.email.mode === "UNAVAILABLE"}>
            <Send className="h-3.5 w-3.5 mr-1.5" /> {t("integr.email.test")}
          </Button>
          {ch?.email.mode === "UNAVAILABLE" && (
            <p className="text-[11px] text-muted-foreground">{t("integr.email.unavailable_hint")}</p>
          )}
        </CardContent>
      </Card>

      {/* TELEGRAM */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="h-4 w-4" /> {t("integr.telegram.title")}</CardTitle>
          <ModeBadge mode={telegram.data?.mode ?? ch?.telegram.mode ?? "UNAVAILABLE"} t={t} />
        </CardHeader>
        <CardContent className="space-y-2.5">
          <p className="text-xs text-muted-foreground">{t("integr.telegram.desc")}</p>
          {telegram.data?.connected ? (
            <div className="space-y-2">
              <p className="text-xs flex items-center gap-1.5">
                <PlugZap className="h-3.5 w-3.5 text-emerald-500" />
                {t("integr.telegram.connected_as")} {telegram.data.chatIdMasked}
                {telegram.data.connectedAt && <span className="text-muted-foreground"> · {timeAgo(telegram.data.connectedAt)}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={onTestTelegram} disabled={telegramTest.isPending}>
                  <Send className="h-3.5 w-3.5 mr-1.5" /> {t("integr.telegram.test")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => telegramDisconnect.mutate()} disabled={telegramDisconnect.isPending}>
                  {t("integr.telegram.disconnect")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const r = await telegramConnect.mutateAsync();
                  setConnectCode(r.code);
                }}
                disabled={telegramConnect.isPending}
              >
                <Plug className="h-3.5 w-3.5 mr-1.5" /> {t("integr.telegram.connect")}
              </Button>
              {connectCode && (
                <div className="rounded-md border bg-muted/40 p-2.5 text-xs space-y-1">
                  <p>{t("integr.telegram.code_instruction")}</p>
                  <p className="font-mono text-base font-bold tracking-[0.3em] select-all">{connectCode}</p>
                  {status.data?.appUrl && <p className="text-[11px] text-muted-foreground">Bot webhook: {status.data.appUrl}/api/v1/integrations/telegram/webhook</p>}
                </div>
              )}
              {isDemo && (
                <div className="space-y-1.5">
                  <button className="text-[11px] underline text-muted-foreground" onClick={() => setShowDemoConnect((v) => !v)}>
                    {t("integr.telegram.demo_connect_toggle")}
                  </button>
                  {showDemoConnect && (
                    <div className="flex gap-2">
                      <Input
                        className="h-8 text-xs"
                        placeholder={t("integr.telegram.chat_id")}
                        value={demoChatId}
                        onChange={(e) => setDemoChatId(e.target.value)}
                        aria-label={t("integr.telegram.chat_id")}
                      />
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            await telegramConnectDemo.mutateAsync(demoChatId.trim());
                            toast.success(t("integr.telegram.connected_ok"));
                            setDemoChatId("");
                          } catch (e) {
                            toast.error((e as Error).message);
                          }
                        }}
                        disabled={!demoChatId.trim()}
                      >
                        {t("common.save")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* WEBHOOK */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base"><WebhookIcon className="h-4 w-4" /> {t("integr.webhook.title")}</CardTitle>
          <ModeBadge mode={ch?.webhook.mode ?? "UNAVAILABLE"} t={t} />
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("integr.webhook.desc")}</p>

          {endpoints.map((ep) => (
            <div key={ep.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{ep.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{ep.url}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t("integr.webhook.events")}: {ep.events} · HMAC-SHA256
                  {ep.lastDeliveryAt && ` · ${t("integr.webhook.last")} ${timeAgo(ep.lastDeliveryAt)} (${ep.lastStatus ?? "—"})`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={ep.enabled}
                  onCheckedChange={(v) => updateWebhook.mutate({ id: ep.id, enabled: v })}
                  aria-label={t("integr.webhook.enabled")}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const r = await testWebhook.mutateAsync(ep.id);
                    if (r.ok) toast.success(t("integr.webhook.test_ok"));
                    else toast.error(r.error ?? t("integr.webhook.test_fail"));
                  }}
                  disabled={testWebhook.isPending}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" /> {t("integr.webhook.test")}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteWebhook.mutate(ep.id)}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}

          <div className="rounded-md border border-dashed p-2.5 space-y-2">
            <p className="text-xs font-medium">{t("integr.webhook.add")}</p>
            <div className="grid sm:grid-cols-3 gap-2">
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">{t("common.name")}</Label>
                <Input className="h-8 text-xs" value={newEp.name} onChange={(e) => setNewEp({ ...newEp, name: e.target.value })} aria-label={t("common.name")} />
              </div>
              <div className="grid gap-1 sm:col-span-2">
                <Label className="text-[11px] text-muted-foreground">URL</Label>
                <Input className="h-8 text-xs" placeholder="https://" value={newEp.url} onChange={(e) => setNewEp({ ...newEp, url: e.target.value })} aria-label="URL" />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!newEp.name.trim() || !newEp.url.trim() || createWebhook.isPending}
              onClick={async () => {
                try {
                  await createWebhook.mutateAsync({ name: newEp.name.trim(), url: newEp.url.trim(), events: newEp.events || "*" });
                  toast.success(t("integr.webhook.created"));
                  setNewEp({ name: "", url: "", events: "*" });
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" /> {t("common.create")}
            </Button>
            <p className="text-[11px] text-muted-foreground">{t("integr.webhook.ssrf_note")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

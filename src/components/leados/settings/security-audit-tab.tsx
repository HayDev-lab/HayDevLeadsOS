"use client";

// SECURITY AUDIT LOG TAB (v0.17 spec 52–57): append-only trail — Who / Action /
// Resource / Time, filterable by action. OWNER/ADMIN only (server-enforced).

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, ShieldCheck, User as UserIcon, Bot, Cpu } from "lucide-react";
import { useAuditLog } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { timeAgo } from "@/components/leados/primitives";

const ACTOR_ICON: Record<string, typeof UserIcon> = {
  USER: UserIcon,
  AUTOMATION: Bot,
  WORKER: Cpu,
  SYSTEM: Cpu,
  ANONYMOUS: UserIcon,
};

const PAGE_SIZE = 30;

export function SecurityAuditTab() {
  const { t } = useLocale();
  const [action, setAction] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const log = useAuditLog(action === "ALL" ? undefined : action, page);
  const rows = log.data?.rows ?? [];
  const total = log.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> {t("audit.title")}
          </CardTitle>
          <CardDescription>{t("audit.hint")}</CardDescription>
        </div>
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="ALL">{t("audit.allActions")}</SelectItem>
            {(log.data?.availableActions ?? []).map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {log.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{t("audit.empty")}</p>
        ) : (
          <>
            <div className="rounded-lg border divide-y max-h-[560px] overflow-y-auto">
              {rows.map((r) => {
                const Icon = ACTOR_ICON[r.actorType] ?? UserIcon;
                return (
                  <div key={r.id} className="flex items-start gap-3 px-3 py-2">
                    <span className="mt-0.5 rounded-md bg-muted p-1.5"><Icon className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium">{r.actor}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5">{r.action}</Badge>
                        <span className="text-[11px] text-muted-foreground">{r.resourceType}{r.resourceId ? ` · ${r.resourceId.slice(0, 8)}…` : ""}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.ip ? `${r.ip} · ` : ""}{timeAgo(r.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">{t("audit.total", { count: total })}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground">{page} / {pages}</span>
                <Button size="sm" variant="outline" className="h-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

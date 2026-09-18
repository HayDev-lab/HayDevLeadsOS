"use client";

import { useDuplicatesScan, useMergeLead } from "@/hooks/leados/use-api";
import { useHashRoute } from "@/lib/leados/hash-route";
import { useT } from "@/lib/leados/locale";
import { localizeStageName } from "@/lib/leados/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Copy, GitMerge, AlertTriangle, ScanSearch } from "lucide-react";
import { LeadAvatar, timeAgo } from "./primitives";
import { toast } from "sonner";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DuplicatesScanner({ children }: { children?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const scan = useDuplicatesScan();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <ScanSearch className="h-4 w-4 mr-1.5" />
            Find duplicates
            {scan.data && scan.data.total > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {scan.data.total}
              </span>
            )}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="h-5 w-5 text-amber-500" />
            Duplicate Lead Scanner
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {scan.isLoading && <Skeleton className="h-20 w-full" />}
          {!scan.isLoading && scan.data && (
            <>
              <p className="text-xs text-muted-foreground">
                Scanned {scan.data.leadsScanned} active leads · found <span className="font-semibold text-foreground">{scan.data.total}</span> duplicate group(s).
                Matches are based on normalized phone or email.
              </p>
              {scan.data.total === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-emerald-100 dark:bg-emerald-950/40 p-3 mb-3">
                    <AlertTriangle className="h-6 w-6 text-emerald-600" />
                  </div>
                  <p className="text-sm font-medium">No duplicates found</p>
                  <p className="text-xs text-muted-foreground mt-1">All leads have unique phone numbers and emails.</p>
                </div>
              )}
              {scan.data.groups.map((g: any) => (
                <DuplicateGroup key={g.key} group={g} onClose={() => setOpen(false)} />
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateGroup({ group, onClose }: { group: any; onClose: () => void }) {
  const t = useT();
  const [, navigate] = useHashRoute();
  const merge = useMergeLead(group.leads[0].id);
  const [busy, setBusy] = useState(false);

  const doMerge = async (targetId: string, sourceId: string) => {
    setBusy(true);
    try {
      await merge.mutateAsync(sourceId);
      toast.success("Leads merged successfully");
      onClose();
      navigate("lead", { id: targetId });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-300/40 dark:border-amber-900/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50/60 dark:bg-amber-950/20 border-b border-amber-200/50 dark:border-amber-900/50">
        <Copy className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-xs font-medium">Matched by {group.reason}</span>
        <Badge variant="outline" className="text-[10px] font-mono px-1 py-0">{group.matchValue}</Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">{group.leads.length} leads</span>
      </div>
      <div className="divide-y">
        {group.leads.map((l: any, i: number) => (
          <div key={l.id} className="flex items-center gap-2.5 px-3 py-2.5">
            <LeadAvatar first={l.firstName} last={l.lastName} size={28} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}</div>
              <div className="text-[11px] text-muted-foreground truncate">{l.company || l.email || l.phone || "—"}</div>
            </div>
            {l.stage && <Badge variant="outline" className="text-[9px] px-1 py-0" title={l.stage.name}>{localizeStageName(t, l.stage.name)}</Badge>}
            <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(l.createdAt)}</span>
            {i === 0 ? (
              <span className="text-[10px] font-semibold text-emerald-600 px-1.5">KEEP</span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                onClick={() => doMerge(group.leads[0].id, l.id)}
                disabled={busy}
              >
                <GitMerge className="h-3 w-3 mr-1" />Merge into ↑
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

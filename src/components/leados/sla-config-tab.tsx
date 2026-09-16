"use client";

import { useState, useEffect } from "react";
import { useSettings } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Save } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_THRESHOLDS = { target: 1, warning: 4, breach: 24 };

export function SlaConfigTab() {
  const settings = useSettings();
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [saving, setSaving] = useState(false);

  // load from settings (stored as a Setting row with key "sla_thresholds")
  useEffect(() => {
    if (settings.data?.settings) {
      const row = (settings.data.settings as any[]).find((s: any) => s.key === "sla_thresholds");
      if (row?.value) {
        try {
          const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
          setThresholds({ target: v.target ?? 1, warning: v.warning ?? 4, breach: v.breach ?? 24 });
        } catch {}
      }
    }
  }, [settings.data]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org: { slaThresholds: thresholds } }),
      });
      if (res.ok) {
        // also store as a setting row
        await fetch("/api/v1/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "sla_thresholds", value: thresholds }),
        });
        toast.success("SLA thresholds saved");
        settings.refetch();
      } else {
        toast.error("Save failed");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (settings.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" />SLA Response Time Thresholds</CardTitle>
        <CardDescription className="text-xs">Configure when response time badges change color. Thresholds are in hours.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Target (green)
            </Label>
            <Input
              type="number"
              min={0}
              max={168}
              value={thresholds.target}
              onChange={(e) => setThresholds((t) => ({ ...t, target: Number(e.target.value) || 0 }))}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">Respond within this time</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Warning (amber)
            </Label>
            <Input
              type="number"
              min={0}
              max={168}
              value={thresholds.warning}
              onChange={(e) => setThresholds((t) => ({ ...t, warning: Number(e.target.value) || 0 }))}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">Slipping — needs attention</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Breach (red)
            </Label>
            <Input
              type="number"
              min={0}
              max={720}
              value={thresholds.breach}
              onChange={(e) => setThresholds((t) => ({ ...t, breach: Number(e.target.value) || 0 }))}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">Critical — likely lost</p>
          </div>
        </div>
        {/* preview */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground mb-2">Preview:</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">✓ &lt; {thresholds.target}h</span>
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">{thresholds.target}–{thresholds.warning}h</span>
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">{thresholds.warning}–{thresholds.breach}h</span>
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">⚠ &gt; {thresholds.breach}h</span>
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save thresholds"}
        </Button>
      </CardContent>
    </Card>
  );
}

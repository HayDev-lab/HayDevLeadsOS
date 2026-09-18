"use client";

import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSources, useUsers, useCreateLead } from "@/hooks/leados/use-api";
import { useHashRoute } from "@/lib/leados/hash-route";
import { useLocale } from "@/lib/leados/locale";
import { toast } from "sonner";
import { AlertTriangle, Loader2, UserPlus, ExternalLink, GitMerge } from "lucide-react";
import { LeadAvatar } from "./primitives";
import { cn } from "@/lib/utils";

export function LeadFormDialog({ children, defaultStageId }: { children?: ReactNode; defaultStageId?: string }) {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [summary, setSummary] = useState("");
  const [requirements, setRequirements] = useState("");
  const [note, setNote] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");

  const { t } = useLocale();
  const sources = useSources();
  const users = useUsers();
  const create = useCreateLead();
  const [, navigate] = useHashRoute();
  const [dupInfo, setDupInfo] = useState<{ id: string; company?: string; firstName?: string } | null>(null);

  const reset = () => {
    setFirst(""); setLast(""); setCompany(""); setPhone(""); setEmail(""); setSourceId(""); setOwnerId(""); setPriority("MEDIUM"); setSummary(""); setRequirements(""); setNote(""); setEstimatedValue("");
    setDupInfo(null);
  };

  const submit = async (force = false) => {
    try {
      const res = await create.mutateAsync({
        firstName: first || undefined,
        lastName: last || undefined,
        company: company || undefined,
        phone: phone || undefined,
        email: email || undefined,
        sourceId: sourceId || undefined,
        ownerId: ownerId || undefined,
        priority: priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
        summary: summary || undefined,
        requirements: requirements || undefined,
        note: note || undefined,
        estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
        stageId: defaultStageId,
        force,
      } as any);
      if (res.duplicate?.hasDuplicates && !res.created) {
        const m = res.duplicate.matches[0];
        setDupInfo({ id: m.id, company: m.company, firstName: m.firstName });
        toast.warning(t("lead.duplicate_detected"), { description: m.company ? `${m.company} (${m.reason})` : `existing lead (${m.reason})` });
        return;
      }
      toast.success(t("toast.lead_created"));
      setOpen(false);
      reset();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children ?? <Button size="sm"><UserPlus className="h-4 w-4 mr-1.5" />{t("leads.new")}</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("leads.new")}</DialogTitle>
          <DialogDescription>{t("dashboard.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("common.name")} *</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder={t("common.name")} value={first} onChange={(e) => setFirst(e.target.value)} />
              <Input placeholder={t("common.surname")} value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("common.company")}</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("common.phone")}</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+374 94 123456" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("common.email")}</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("common.source")}</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger>
              <SelectContent>
                {(sources.data?.rows ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("common.owner")}</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue placeholder={t("common.unassigned")} /></SelectTrigger>
              <SelectContent>
                {(users.data?.rows ?? []).map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("common.priority")}</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">{t("priority.low")}</SelectItem>
                <SelectItem value="MEDIUM">{t("priority.medium")}</SelectItem>
                <SelectItem value="HIGH">{t("priority.high")}</SelectItem>
                <SelectItem value="URGENT">{t("priority.urgent")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("common.value")} ({t("common.demo")})</Label>
            <Input type="number" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} placeholder="0" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{t("common.summary")}</Label>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{t("lead.requirements")}</Label>
            <Textarea rows={2} value={requirements} onChange={(e) => setRequirements(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{t("common.note")}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("lead.note_placeholder")} />
          </div>
        </div>
        {dupInfo && (
          <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-900 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="font-semibold">{t("lead.duplicate_detected")}</span>
              <span className="text-muted-foreground">{dupInfo.company || dupInfo.firstName}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setOpen(false); reset(); navigate("lead", { id: dupInfo.id }); }}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />{t("lead.merge.open_existing")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setOpen(false); reset(); navigate("lead", { id: dupInfo.id }); }}>
                <GitMerge className="h-3.5 w-3.5 mr-1.5" />{t("lead.merge")}
              </Button>
              <Button size="sm" onClick={() => submit(true)} disabled={create.isPending}>
                {t("lead.merge.create_anyway")}
              </Button>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => submit(false)} disabled={create.isPending || (!first && !company && !phone && !email)}>
            {create.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

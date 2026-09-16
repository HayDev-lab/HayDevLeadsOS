"use client";

import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useImportCsv, useSources } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

const SAMPLE = `first_name,last_name,company,phone,email,source,priority,summary
Tigran,Petrosyan,Astghik Construction,+37494123456,tigran@astghik.am,website,HIGH,ERP for construction
Anna,Hakobyan,Yerevan Dental,+37455112233,anna@ydc.am,instagram,URGENT,CRM for clinic`;

export function ImportDialog({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [sourceType, setSourceType] = useState("manual");
  const imp = useImportCsv();
  const { t } = useLocale();
  const sources = useSources();

  const submit = async () => {
    if (!csv.trim()) return;
    try {
      const res = await imp.mutateAsync({ csv, sourceType });
      toast.success(t("toast.imported", res.imported));
      setOpen(false);
      setCsv("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children ?? <Button variant="outline" size="sm"><Upload className="h-4 w-4 mr-1.5" />{t("leads.import")}</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("leads.import")}</DialogTitle>
          <DialogDescription>CSV with headers: first_name, last_name, company, phone, email, source, priority, summary. Auto-maps common headers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Default source type</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(sources.data?.rows ?? []).map((s: any) => <SelectItem key={s.id} value={s.type}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">CSV data</Label>
            <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} className="font-mono text-xs" />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCsv(SAMPLE)}>Use sample</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={imp.isPending || !csv.trim()}>
            {imp.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {t("leads.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

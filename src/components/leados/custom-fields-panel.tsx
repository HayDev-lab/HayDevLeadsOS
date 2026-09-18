"use client";

import { useCustomFields, useSetCustomValue } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRef, useState } from "react";

interface CustomValue {
  id: string;
  fieldId: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBool: boolean | null;
  valueDate: Date | null;
  field: { id: string; name: string; key: string; type: string; options: string[] | null };
}

export function CustomFieldsPanel({ leadId, values }: { leadId: string; values: CustomValue[] }) {
  const { t } = useLocale();
  const fields = useCustomFields();
  const orgFields = fields.data?.rows ?? [];

  if (!orgFields.length) return null;

  // build a map fieldId -> existing value
  const valueMap = new Map(values.map((v) => [v.fieldId, v]));

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          {t("settings.custom_fields")}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2.5">
        {orgFields.map((f: any) => {
          const v = valueMap.get(f.id);
          return (
            <CustomFieldRow
              key={f.id + ":" + (v?.id ?? "none")}
              leadId={leadId}
              field={f}
              existing={v}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

function CustomFieldRow({ leadId, field, existing }: { leadId: string; field: any; existing?: CustomValue }) {
  const set = useSetCustomValue(field.id);
  const { t } = useLocale();
  const opts = Array.isArray(field.options) ? field.options : [];
  const [localText, setLocalText] = useState(existing?.valueText ?? "");
  const [localNumber, setLocalNumber] = useState(existing?.valueNumber?.toString() ?? "");
  const [localBool, setLocalBool] = useState(existing?.valueBool ?? false);
  const [localDate, setLocalDate] = useState(existing?.valueDate ? new Date(existing.valueDate).toISOString().slice(0, 10) : "");
  const [localSelect, setLocalSelect] = useState(existing?.valueText ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = (patch: Record<string, unknown>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await set.mutateAsync({ leadId, ...patch } as any);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }, 400);
  };

  const label = <span className="text-xs text-muted-foreground truncate">{field.name}</span>;

  if (field.type === "text") {
    return (
      <div className="space-y-1">
        {label}
        <Input
          value={localText}
          onChange={(e) => { setLocalText(e.target.value); save({ valueText: e.target.value }); }}
          placeholder="—"
          className="h-8 text-sm"
        />
      </div>
    );
  }
  if (field.type === "number") {
    return (
      <div className="space-y-1">
        {label}
        <Input
          type="number"
          value={localNumber}
          onChange={(e) => { setLocalNumber(e.target.value); save({ valueNumber: e.target.value ? Number(e.target.value) : null }); }}
          placeholder="—"
          className="h-8 text-sm"
        />
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className="space-y-1">
        {label}
        <Select value={localSelect || "__none"} onValueChange={(v) => { const val = v === "__none" ? "" : v; setLocalSelect(val); save({ valueText: val || null }); }}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {opts.map((o: string) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (field.type === "bool") {
    return (
      <div className="flex items-center justify-between gap-2">
        {label}
        <button
          onClick={() => { const v = !localBool; setLocalBool(v); save({ valueBool: v }); }}
          className={cn("relative h-5 w-9 rounded-full transition", localBool ? "bg-primary" : "bg-muted")}
        >
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform", localBool ? "translate-x-4" : "translate-x-0.5")} />
        </button>
      </div>
    );
  }
  if (field.type === "date") {
    return (
      <div className="space-y-1">
        {label}
        <Input
          type="date"
          value={localDate}
          onChange={(e) => { setLocalDate(e.target.value); save({ valueDate: e.target.value || null }); }}
          className="h-8 text-sm"
        />
      </div>
    );
  }
  return null;
}

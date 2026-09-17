"use client";

// HAYDEV LEADOS — AUTOMATION RULE BUILDER (v0.15, spec 40–44, 104–106).
//
// A simple VERTICAL builder — NOT an n8n clone (spec 129):
//   WHEN  [ trigger select ]
//   IF    [ field ][ operator ][ value ] … + ALL/ANY mode
//   THEN  [ action type + structured params ] …
// Structured selects only — the user never writes code (spec 6).

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/leados/locale";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  useUsers,
  useSources,
  usePipeline,
  useCreateAutomation,
  useUpdateAutomation,
  type AutomationRuleRow,
} from "@/hooks/leados/use-api";
import { DOMAIN_EVENT_TYPES } from "@/lib/domain-events";
import { CONDITION_FIELDS, type ConditionItem, type ConditionOperator } from "@/lib/automation-conditions";
import { AUTOMATION_ACTION_TYPES, ACTION_ASSIGNEE, type AutomationActionType } from "@/lib/automation-actions";

export interface BuilderDraft {
  name: string;
  description: string;
  triggerType: string;
  mode: "all" | "any";
  conditions: ConditionItem[];
  actions: { type: AutomationActionType; params: Record<string, unknown> }[];
  enabled: boolean;
}

export function draftFromTemplate(tpl: { name: string; description?: string; triggerType: string; conditions?: unknown; actions?: unknown }): BuilderDraft {
  const group = (tpl.conditions ?? null) as { all?: ConditionItem[]; any?: ConditionItem[] } | null;
  const mode: "all" | "any" = group?.any ? "any" : "all";
  const actions = Array.isArray(tpl.actions) ? (tpl.actions as { type: AutomationActionType; params: Record<string, unknown> }[]) : [];
  return {
    name: tpl.name,
    description: tpl.description ?? "",
    triggerType: tpl.triggerType,
    mode,
    conditions: group?.all ?? group?.any ?? [],
    actions: actions.map((a) => ({ type: a.type, params: { ...a.params } })),
    enabled: true,
  };
}

export function draftFromRule(rule: AutomationRuleRow): BuilderDraft {
  const group = (rule.conditions ?? null) as { all?: ConditionItem[]; any?: ConditionItem[] } | null;
  return {
    name: rule.name,
    description: rule.description ?? "",
    triggerType: rule.triggerType,
    mode: group?.any ? "any" : "all",
    conditions: group?.all ?? group?.any ?? [],
    actions: (rule.actions ?? []).map((a) => ({ type: a.type as AutomationActionType, params: { ...a.params } })),
    enabled: rule.enabled,
  };
}

export function emptyDraft(): BuilderDraft {
  return {
    name: "",
    description: "",
    triggerType: "STAGE_BECAME_STALE",
    mode: "all",
    conditions: [],
    actions: [{ type: "CREATE_TASK", params: defaultParamsFor("CREATE_TASK") }],
    enabled: true,
  };
}

function defaultParamsFor(type: AutomationActionType): Record<string, unknown> {
  switch (type) {
    case "CREATE_TASK":
      return { title: "", assignTo: ACTION_ASSIGNEE.LEAD_OWNER, priority: "HIGH" };
    case "CREATE_NOTIFICATION":
      return { message: "", recipient: ACTION_ASSIGNEE.LEAD_OWNER };
    case "SET_LEAD_PRIORITY":
      return { priority: "HIGH" };
    case "ASSIGN_LEAD":
      return { assignTo: ACTION_ASSIGNEE.SPECIFIC_USER };
    case "ADD_NOTE":
      return { content: "" };
    default:
      return {};
  }
}

/** Localized label for enum values used in condition selects + traces. */
export function enumLabel(v: string, t: (key: string) => string): string {
  if (["LOW", "MEDIUM", "HIGH", "URGENT"].includes(v)) return t(`priority.${v.toLowerCase()}`);
  if (["open", "won", "lost"].includes(v)) return t(`stage.type.${v}`);
  if (["NEW", "OPEN", "CONTACTED", "QUALIFIED", "WON", "LOST", "ARCHIVED"].includes(v)) return t(`status.${v.toLowerCase()}`);
  if (["TODO", "IN_PROGRESS", "DONE", "CANCELLED"].includes(v)) return t(`task.status.${v}`);
  return t(`auto.trigger.${v}`);
}

export function RuleBuilderDialog({
  open,
  onOpenChange,
  rule,
  initialDraft,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Existing rule (edit mode) or null (create mode). */
  rule: AutomationRuleRow | null;
  /** Prefilled draft for template / create flows. */
  initialDraft: BuilderDraft | null;
}) {
  const { t } = useLocale();
  const tr = (key: string): string => t(key as Parameters<typeof t>[0]);
  const users = useUsers();
  const sources = useSources();
  const pipeline = usePipeline();
  const createRule = useCreateAutomation();
  const updateRule = useUpdateAutomation();

  const [draft, setDraft] = useState<BuilderDraft>(initialDraft ?? emptyDraft());
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setDraft(initialDraft ?? (rule ? draftFromRule(rule) : emptyDraft()));
      setErrors([]);
    }
  }, [open, rule?.id, initialDraft]);

  const userRows: { id: string; name: string }[] = useMemo(
    () => ((users.data?.rows ?? []) as { id: string; name: string }[]),
    [users.data]
  );
  const sourceRows: { id: string; name: string }[] = useMemo(
    () => ((sources.data?.rows ?? []) as { id: string; name: string }[]),
    [sources.data]
  );
  const stageRows: { id: string; name: string }[] = useMemo(() => {
    const pipelines = (pipeline.data?.pipelines ?? []) as {
      id: string;
      name: string;
      stages?: { id: string; name: string }[];
    }[];
    return pipelines.flatMap((p) => p.stages ?? []);
  }, [pipeline.data]);

  const valueOptionsFor = (field: string): { value: string; label: string }[] => {
    const def = CONDITION_FIELDS[field];
    if (!def) return [];
    if (def.dynamicRef === "sourceId") return sourceRows.map((s) => ({ value: s.id, label: s.name }));
    if (def.dynamicRef === "stageId") return stageRows.map((s) => ({ value: s.id, label: s.name }));
    if (def.dynamicRef === "userId") return userRows.map((u) => ({ value: u.id, label: u.name }));
    if (def.enumValues) return def.enumValues.map((v) => ({ value: v, label: enumLabel(v, tr) }));
    return [];
  };

  function setField<K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function updateCondition(i: number, patch: Partial<ConditionItem>) {
    setDraft((d) => {
      const conditions = [...d.conditions];
      conditions[i] = { ...conditions[i], ...patch };
      return { ...d, conditions };
    });
  }

  function updateActionType(i: number, type: AutomationActionType) {
    setDraft((d) => {
      const actions = [...d.actions];
      actions[i] = { type, params: defaultParamsFor(type) };
      return { ...d, actions };
    });
  }

  function updateActionParam(i: number, key: string, value: unknown) {
    setDraft((d) => {
      const actions = [...d.actions];
      actions[i] = { ...actions[i], params: { ...actions[i].params, [key]: value } };
      return { ...d, actions };
    });
  }

  async function handleSave() {
    setSaving(true);
    setErrors([]);
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      triggerType: draft.triggerType,
      conditions: draft.conditions.length
        ? { [draft.mode]: draft.conditions.filter((c) => c.field && c.operator) }
        : null,
      actions: draft.actions.filter((a) => a.type),
      enabled: draft.enabled,
    };
    try {
      if (rule) {
        await updateRule.mutateAsync({ id: rule.id, body });
      } else {
        await createRule.mutateAsync(body);
      }
      toast.success(t("auto.rule_saved"));
      onOpenChange(false);
    } catch (e) {
      const err = e as { message?: string; details?: unknown };
      const details = (err as { response?: { json?: () => Promise<unknown> } }).response;
      // jfetch throws Error(message) with the server's `error` text; details
      // arrive via the message when the server prefixes them.
      const lines: string[] = [];
      if (err.message && err.message !== "Validation failed") lines.push(err.message);
      if (details) lines.push(String(details));
      setErrors(lines.length ? lines : [String(err.message ?? "Error")]);
    } finally {
      setSaving(false);
    }
  }

  const canSave = draft.name.trim().length > 0 && draft.actions.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-primary" />
            {rule ? t("common.edit") : t("auto.create")}
          </DialogTitle>
          <DialogDescription className="text-xs">{t("auto.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-4 space-y-5">
            {/* Name + description */}
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="rule-name">{t("auto.rule_name")} *</Label>
                <Input
                  id="rule-name"
                  value={draft.name}
                  maxLength={120}
                  placeholder={t("auto.rule_name_ph")}
                  onChange={(e) => setField("name", e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rule-desc">{t("auto.description")}</Label>
                <Input
                  id="rule-desc"
                  value={draft.description}
                  maxLength={500}
                  onChange={(e) => setField("description", e.target.value)}
                />
              </div>
            </div>

            {/* WHEN */}
            <section className="rounded-lg border bg-muted/30 p-3.5 space-y-2.5" aria-label={t("auto.when")}>
              <span className="inline-flex h-5 items-center rounded bg-sky-500/15 px-1.5 text-[10px] font-bold tracking-wide text-sky-600 dark:text-sky-300">
                {t("auto.when")}
              </span>
              <Select value={draft.triggerType} onValueChange={(v) => setField("triggerType", v)}>
                <SelectTrigger className="w-full" aria-label={t("auto.when")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOMAIN_EVENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {tr(`auto.trigger.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            {/* IF */}
            <section className="rounded-lg border bg-muted/30 p-3.5 space-y-2.5" aria-label={t("auto.if")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex h-5 items-center rounded bg-amber-500/15 px-1.5 text-[10px] font-bold tracking-wide text-amber-600 dark:text-amber-300">
                  {t("auto.if")}
                </span>
                <Select value={draft.mode} onValueChange={(v) => setField("mode", v as "all" | "any")}>
                  <SelectTrigger className="h-8 w-[150px] text-xs" aria-label={t("auto.if")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("auto.all_conditions")}</SelectItem>
                    <SelectItem value="any">{t("auto.any_condition")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {draft.conditions.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("auto.no_conditions")}</p>
              )}

              {draft.conditions.map((c, i) => {
                const def = CONDITION_FIELDS[c.field];
                const isListOp = c.operator === "in" || c.operator === "not_in";
                const isExistOp = c.operator === "exists" || c.operator === "not_exists";
                const options = valueOptionsFor(c.field);
                const needsChoice = !isExistOp && !isListOp && def?.type !== "number" && options.length > 0;
                return (
                  <div key={i} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <Select
                      value={c.field}
                      onValueChange={(v) => updateCondition(i, { field: v, operator: CONDITION_FIELDS[v]?.operators[0], value: undefined })}
                    >
                      <SelectTrigger className="w-full sm:w-[38%] text-xs" aria-label={t("auto.field")}>
                        <SelectValue placeholder={t("auto.field")} />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CONDITION_FIELDS).map(([f, fd]) => (
                          <SelectItem key={f} value={f}>
                            {tr(fd.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={c.operator}
                      onValueChange={(v) => updateCondition(i, { operator: v as ConditionOperator })}
                    >
                      <SelectTrigger className="w-full sm:w-[24%] text-xs" aria-label={t("auto.operator")}>
                        <SelectValue placeholder={t("auto.operator")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(def?.operators ?? []).map((op) => (
                          <SelectItem key={op} value={op}>
                            {tr(`auto.op.${op}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex-1 min-w-0">
                      <ConditionValueInput
                        condition={c}
                        def={def}
                        options={options}
                        onChange={(value) => updateCondition(i, { value })}
                        t={tr}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setField("conditions", draft.conditions.filter((_, j) => j !== i))}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    setField("conditions", [
                      ...draft.conditions,
                      { field: "lead.priority", operator: "equals", value: "HIGH" },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> {t("auto.add_condition")}
                </Button>
                <p className="text-[10px] text-muted-foreground hidden sm:block">{t("auto.conditions_hint")}</p>
              </div>
            </section>

            {/* THEN */}
            <section className="rounded-lg border bg-muted/30 p-3.5 space-y-2.5" aria-label={t("auto.then")}>
              <span className="inline-flex h-5 items-center rounded bg-emerald-500/15 px-1.5 text-[10px] font-bold tracking-wide text-emerald-600 dark:text-emerald-300">
                {t("auto.then")}
              </span>

              {draft.actions.map((a, i) => (
                <div key={i} className="rounded-md border bg-background p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Select value={a.type} onValueChange={(v) => updateActionType(i, v as AutomationActionType)}>
                      <SelectTrigger className="h-8 flex-1 text-xs font-medium" aria-label={t("auto.then")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTOMATION_ACTION_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {tr(`auto.action.${type}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setField("actions", draft.actions.filter((_, j) => j !== i))}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <ActionParams
                    action={a}
                    users={userRows}
                    onParam={(key, value) => updateActionParam(i, key, value)}
                    t={tr}
                  />
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setField("actions", [...draft.actions, { type: "CREATE_TASK", params: defaultParamsFor("CREATE_TASK") }])}
              >
                <Plus className="h-3.5 w-3.5" /> {t("auto.add_action")}
              </Button>
            </section>

            {/* Enabled */}
            <div className="flex items-center justify-between rounded-lg border p-3.5">
              <div>
                <p className="text-sm font-medium">{draft.enabled ? t("auto.status.active") : t("auto.status.paused")}</p>
                <p className="text-[11px] text-muted-foreground">{t("auto.enabled_hint")}</p>
              </div>
              <Switch checked={draft.enabled} onCheckedChange={(v) => setField("enabled", v)} aria-label={t("auto.status.active")} />
            </div>

            {errors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-1" role="alert">
                {errors.map((e, i) => (
                  <p key={i} className="text-xs text-destructive">{e}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Condition value input (spec 6: structured, no raw code)
// ---------------------------------------------------------------------------

function ConditionValueInput({
  condition,
  def,
  options,
  onChange,
  t,
}: {
  condition: ConditionItem;
  def: { operators: string[]; type: string } | undefined;
  options: { value: string; label: string }[];
  onChange: (value: unknown) => void;
  t: (key: string) => string;
}) {
  if (condition.operator === "exists" || condition.operator === "not_exists" || !def) {
    return <div className="h-8" />;
  }
  if (condition.operator === "in" || condition.operator === "not_in") {
    const selected = Array.isArray(condition.value) ? (condition.value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-1 border rounded-md p-1.5 min-h-8 bg-background">
        {options.map((o) => {
          const active = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() =>
                onChange(active ? selected.filter((v) => v !== o.value) : [...selected, o.value])
              }
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium border transition ${
                active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 hover:bg-accent"
              }`}
            >
              {o.label}
            </button>
          );
        })}
        {options.length === 0 && <span className="text-[11px] text-muted-foreground px-1">—</span>}
      </div>
    );
  }
  if (def.type === "number") {
    return (
      <Input
        type="number"
        className="h-8 text-xs"
        value={condition.value == null ? "" : String(condition.value)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        aria-label={t("auto.value")}
        placeholder={t("auto.value")}
      />
    );
  }
  if (options.length > 0) {
    return (
      <Select value={condition.value == null ? undefined : String(condition.value)} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="h-8 text-xs" aria-label={t("auto.value")}>
          <SelectValue placeholder={t("auto.value")} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      className="h-8 text-xs"
      value={condition.value == null ? "" : String(condition.value)}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t("auto.value")}
      placeholder={t("auto.value")}
    />
  );
}

// ---------------------------------------------------------------------------
// Action params (structured per action type)
// ---------------------------------------------------------------------------

function ActionParams({
  action,
  users,
  onParam,
  t,
}: {
  action: { type: string; params: Record<string, unknown> };
  users: { id: string; name: string }[];
  onParam: (key: string, value: unknown) => void;
  t: (key: string) => string;
}) {
  const p = action.params ?? {};

  const assigneeSelect = (key: string, allowed: string[], label: string) => (
    <div className="grid gap-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={String(p[key] ?? "")} onValueChange={(v) => onParam(key, v)}>
        <SelectTrigger className="h-8 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowed.map((a) => (
            <SelectItem key={a} value={a}>{t(`auto.assign.${a}`)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const userSelect = () => (
    <div className="grid gap-1">
      <Label className="text-[11px] text-muted-foreground">{t("auto.action.user")}</Label>
      <Select value={String(p.userId ?? "")} onValueChange={(v) => onParam("userId", v)}>
        <SelectTrigger className="h-8 text-xs" aria-label={t("auto.action.user")}>
          <SelectValue placeholder={t("auto.action.user")} />
        </SelectTrigger>
        <SelectContent>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const prioritySelect = (value: string, onValue: (v: string) => void) => (
    <Select value={value} onValueChange={onValue}>
      <SelectTrigger className="h-8 text-xs" aria-label={t("auto.action.priority")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {["LOW", "MEDIUM", "HIGH", "URGENT"].map((v) => (
          <SelectItem key={v} value={v}>{enumLabel(v, t)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  switch (action.type) {
    case "CREATE_TASK":
      return (
        <div className="grid sm:grid-cols-2 gap-2.5">
          <div className="grid gap-1 sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">{t("auto.action.title")} *</Label>
            <Input
              className="h-8 text-xs"
              value={String(p.title ?? "")}
              onChange={(e) => onParam("title", e.target.value)}
              placeholder="…{leadName}"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("auto.action.due_in_hours")}</Label>
            <Input
              type="number"
              min={1}
              className="h-8 text-xs"
              value={p.dueInHours == null ? "" : String(p.dueInHours)}
              onChange={(e) => onParam("dueInHours", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("auto.action.priority")}</Label>
            {prioritySelect(String(p.priority ?? "HIGH"), (v) => onParam("priority", v))}
          </div>
          {assigneeSelect("assignTo", Object.values(ACTION_ASSIGNEE), t("auto.action.assign_to"))}
          {p.assignTo === "SPECIFIC_USER" ? userSelect() : null}
        </div>
      );

    case "CREATE_NOTIFICATION":
      return (
        <div className="grid gap-2.5">
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("auto.action.message")} *</Label>
            <Textarea
              className="min-h-[52px] text-xs"
              value={String(p.message ?? "")}
              onChange={(e) => onParam("message", e.target.value)}
              placeholder="…{leadName}"
              maxLength={500}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {assigneeSelect("recipient", Object.values(ACTION_ASSIGNEE), t("auto.action.recipient"))}
            {p.recipient === "SPECIFIC_USER" ? userSelect() : null}
          </div>
        </div>
      );

    case "SET_LEAD_PRIORITY":
      return (
        <div className="grid sm:grid-cols-2 gap-2.5">
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("auto.action.priority")}</Label>
            {prioritySelect(String(p.priority ?? "HIGH"), (v) => onParam("priority", v))}
          </div>
        </div>
      );

    case "ASSIGN_LEAD":
      return (
        <div className="grid sm:grid-cols-2 gap-2.5">
          {assigneeSelect("assignTo", ["SPECIFIC_USER", "ORGANIZATION_OWNER"], t("auto.action.assign_to"))}
          {p.assignTo === "SPECIFIC_USER" ? userSelect() : null}
        </div>
      );

    case "ADD_NOTE":
      return (
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("auto.action.content")} *</Label>
          <Textarea
            className="min-h-[52px] text-xs"
            value={String(p.content ?? "")}
            onChange={(e) => onParam("content", e.target.value)}
            maxLength={2000}
          />
        </div>
      );

    default:
      return null;
  }
}

"use client";

import { useEffect, useState } from "react";
import { useTasks, useUpdateTask, useDeleteTask, useCreateTask, useUsers } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { useHashRoute } from "@/lib/leados/hash-route";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Circle, Clock, Plus, Trash2, AlertCircle, Calendar, Zap } from "lucide-react";
import { OwnerChip, PriorityBadge, timeAgo, EmptyState } from "./primitives";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function TasksView() {
  const { t } = useLocale();
  const [route, navigate] = useHashRoute();
  const [filter, setFilter] = useState<"todo" | "overdue" | "done">("todo");
  const tasks = useTasks(filter === "done" ? ["DONE"] : filter === "overdue" ? ["TODO", "IN_PROGRESS"] : ["TODO", "IN_PROGRESS"]);
  const update = useUpdateTask();
  const del = useDeleteTask();

  // DEEP LINK FOCUS (event engine): `#/tasks?task=<id>` — highlight the row.
  const focusTaskId = route.params.task ?? null;
  useEffect(() => {
    if (focusTaskId) {
      const el = document.getElementById(`task-${focusTaskId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusTaskId, tasks.data]);

  const rows = tasks.data?.rows ?? [];
  const now = Date.now();
  const filtered = filter === "overdue" ? rows.filter((r: any) => r.dueAt && new Date(r.dueAt).getTime() < now) : rows;

  const toggle = async (task: any) => {
    try {
      await update.mutateAsync({ id: task.id, body: { status: task.status === "DONE" ? "TODO" : "DONE" } });
    } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (id: string) => {
    try { await del.mutateAsync(id); toast.success("Task deleted"); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="px-4 md:px-6 py-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("tasks.title")}</h1>
          <p className="text-sm text-muted-foreground">{rows.length} tasks</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            {(["todo", "overdue", "done"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition", filter === f ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
                {f === "todo" ? "Active" : f === "overdue" ? "Overdue" : "Done"}
              </button>
            ))}
          </div>
          <NewTaskDialog><Button size="sm"><Plus className="h-4 w-4 mr-1.5" />{t("tasks.new")}</Button></NewTaskDialog>
        </div>
      </div>

      <Card className="divide-y">
        {tasks.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        {filtered.length === 0 && !tasks.isLoading && <EmptyState icon={CheckCircle2} title={t("tasks.empty")} />}
        {filtered.map((task: any) => {
          const overdue = task.status !== "DONE" && task.dueAt && new Date(task.dueAt).getTime() < now;
          return (
            <div key={task.id} id={`task-${task.id}`} className={cn("flex items-start gap-3 px-3 py-3 hover:bg-accent/40 transition", focusTaskId === task.id && "ring-2 ring-primary ring-inset rounded-md bg-primary/5")}>
              <button onClick={() => toggle(task)} className="mt-0.5 shrink-0">
                {task.status === "DONE" ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn("text-sm font-medium", task.status === "DONE" && "line-through text-muted-foreground")}>{task.title}</span>
                  <PriorityBadge priority={task.priority} />
                  {task.automationRuleId && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/10 border border-violet-200 px-1 py-px text-[9px] font-semibold text-violet-600 dark:text-violet-300 dark:border-violet-900" title="Created by automation">
                      <Zap className="h-2.5 w-2.5" /> {t("auto.automated")}
                    </span>
                  )}
                  {overdue && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600"><AlertCircle className="h-3 w-3" /> {timeAgo(task.dueAt)}</span>}
                </div>
                {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {task.lead && <button onClick={() => navigate("lead", { id: task.lead.id })} className="hover:text-foreground hover:underline">{task.lead.company || [task.lead.firstName, task.lead.lastName].filter(Boolean).join(" ")}</button>}
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : "—"}</span>
                  {task.assignee && <OwnerChip name={task.assignee.name} avatarColor={task.assignee.avatarColor} />}
                  <button onClick={() => remove(task.id)} className="ml-auto hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function NewTaskDialog({ children }: { children?: React.ReactNode }) {
  const { t } = useLocale();
  const users = useUsers();
  const create = useCreateTask();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueAt, setDueAt] = useState("");

  const submit = async () => {
    if (!title.trim()) return;
    try {
      await create.mutateAsync({ title, description, assignedTo: assignedTo || undefined, priority, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined } as any);
      toast.success(t("toast.task_created"));
      setOpen(false); setTitle(""); setDescription(""); setAssignedTo(""); setPriority("MEDIUM"); setDueAt("");
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("tasks.new")}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1"><Label className="text-xs">Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Description</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Assignee</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}><SelectTrigger><SelectValue placeholder="Me" /></SelectTrigger><SelectContent>{(users.data?.rows ?? []).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Due date</Label><Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={create.isPending || !title.trim()}>{t("common.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

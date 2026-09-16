"use client";

import { useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { useKanban, useSetLeadStage } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { useHashRoute } from "@/lib/leados/hash-route";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadAvatar, PriorityBadge, ScoreBadge, formatMoney, EmptyState } from "./primitives";
import { cn } from "@/lib/utils";
import { KanbanSquare, GripVertical } from "lucide-react";
import { toast } from "sonner";

export function PipelineView() {
  const { t } = useLocale();
  const [, navigate] = useHashRoute();
  const kanban = useKanban();
  const setStage = useSetLeadStage();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const columns = kanban.data?.columns ?? [];
  const allLeads = columns.flatMap((c: any) => c.leads);
  const activeLead = activeId ? allLeads.find((l: any) => l.id === activeId) : null;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const leadId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const lead = allLeads.find((l: any) => l.id === leadId);
    if (!lead || lead.stageId === overId) return;
    try {
      await setStage.mutateAsync({ leadId, stageId: overId });
      toast.success(t("toast.stage_changed"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="px-4 md:px-6 py-5 h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><KanbanSquare className="h-6 w-6" />{t("pipeline.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pipeline.drag_hint")} · {kanban.data?.totals?.leads ?? 0} {t("pipeline.total").toLowerCase()} · {formatMoney(kanban.data?.totals?.estValue, "AMD")} {t("pipeline.est_value").toLowerCase()}</p>
        </div>
      </div>

      {kanban.isLoading && <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 flex-1"><Skeleton className="h-full" />{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-full" />)}</div>}

      {!kanban.isLoading && columns.length === 0 && <EmptyState icon={KanbanSquare} title={t("common.empty")} />}

      {columns.length > 0 && (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 flex-1 min-h-0">
            {columns.map((col: any) => (
              <Column key={col.id} stage={col} onClick={(id) => navigate("lead", { id })} />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? <LeadCard lead={activeLead} dragging onClick={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function Column({ stage, onClick }: { stage: any; onClick: (id: string) => void }) {
  const { t } = useLocale();
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const leads: any[] = stage.leads;
  const value = leads.reduce((acc, l) => acc + (l.estimatedValue ?? 0), 0);
  return (
    <div ref={setNodeRef} className={cn("flex flex-col rounded-xl border bg-muted/30 min-h-0", isOver && "ring-2 ring-primary/40 bg-primary/5")}>
      <div className="flex items-center justify-between px-2.5 py-2 border-b">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color ?? "#94a3b8" }} />
          <span className="text-xs font-semibold truncate">{stage.name}</span>
          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1">{leads.length}</span>
        </div>
      </div>
      {value > 0 && <div className="px-2.5 pb-1.5 text-[10px] text-muted-foreground">{formatMoney(value)}</div>}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5 min-h-[120px]">
        {leads.length === 0 && <div className="text-[10px] text-muted-foreground/60 text-center py-6">{t("common.empty")}</div>}
        {leads.map((l: any) => (
          <DraggableCard key={l.id} lead={l} onClick={onClick} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({ lead, onClick }: { lead: any; onClick: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-none", isDragging && "opacity-30")}>
      <LeadCard lead={lead} onClick={onClick} />
    </div>
  );
}

function LeadCard({ lead, dragging, onClick }: { lead: any; dragging?: boolean; onClick: (id: string) => void }) {
  return (
    <Card
      onClick={() => onClick(lead.id)}
      className={cn("p-2.5 cursor-pointer hover:shadow-md hover:border-primary/40 transition", dragging && "shadow-xl rotate-2 border-primary")}
    >
      <div className="flex items-start gap-2">
        <LeadAvatar first={lead.firstName} last={lead.lastName} color={lead.owner?.avatarColor} size={26} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—"}</div>
          <div className="text-[11px] text-muted-foreground truncate">{lead.company || "—"}</div>
        </div>
        {lead.estimatedValue ? <span className="text-[10px] font-medium text-muted-foreground">{formatMoney(lead.estimatedValue)}</span> : null}
      </div>
      <div className="flex items-center justify-between mt-2">
        <PriorityBadge priority={lead.priority} />
        <ScoreBadge score={lead.leadScore} category={lead.scoreCategory} />
      </div>
      {!lead.ownerId && <div className="mt-1.5 text-[10px] text-amber-600 font-medium">⚠ Unassigned</div>}
    </Card>
  );
}

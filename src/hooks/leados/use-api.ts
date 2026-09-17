"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = "/api/v1";

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body?.error ?? msg;
    } catch {}
    throw new Error(msg || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => jfetch<T>(path),
  post: <T>(path: string, body?: unknown) => jfetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => jfetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => jfetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => jfetch<T>(path, { method: "DELETE" }),
};

// ---------- queries ----------

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () =>
      api.get<{
        session: {
          user: { id: string; name: string; email: string; role: string; title?: string | null; avatarColor?: string | null };
          organization: { id: string; name: string; slug: string; locale: string; timezone: string; currency: string };
        };
        users: { id: string; name: string; email: string; role: string; title?: string | null; avatarColor?: string | null }[];
      }>("/session"),
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () =>
      api.get<{
        metrics: { newLeads: number; unassigned: number; overdueFollowups: number; qualified: number; meetings: number; proposals: number; won: number; lost: number; totalActive: number; slaBreached: number; followUpsDueToday: number; tasksDueToday: number; meetingsToday: number; staleDeals: number };
        bySource: { source: string; type: string; count: number }[];
        byStage: { stage: string; type: string; count: number; color: string | null }[];
        recent: any[];
        overdueTasks: any[];
        activity: any[];
        attention: any[];
        urgentUnassigned: number;
        slaAttention: {
          counts: { firstResponseBreached: number; followUpsOverdue: number; staleDeals: number; totalIssues: number; leadsWithIssues: number };
          items: { leadId: string; leadName: string; issues: { kind: "FIRST_RESPONSE" | "FOLLOW_UP" | "STAGE_INACTIVITY"; severity: "CRITICAL" | "WARNING"; overdueMinutes: number | null }[] }[];
        };
      }>("/dashboard"),
    refetchInterval: 30_000,
  });
}

export function useLostDetector() {
  return useQuery({
    queryKey: ["lost-detector"],
    queryFn: () => api.get<{ flags: any[]; leadsNeedingAttention: number; total: number; labels: Record<string, string> }>("/lost-detector"),
    refetchInterval: 60_000,
  });
}

export interface LeadsQuery {
  q?: string;
  sourceId?: string;
  sourceType?: string;
  ownerId?: string;
  stageId?: string;
  priority?: string[];
  status?: string[];
  tags?: string[];
  overdue?: boolean;
  unassigned?: boolean;
  archived?: boolean;
  sla?: string;
  followUp?: string;
  stageHealth?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export function useLeads(q: LeadsQuery) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(","));
    } else p.set(k, String(v));
  }
  return useQuery({
    queryKey: ["leads", p.toString()],
    queryFn: () => api.get<{ rows: any[]; total: number; page: number; limit: number; pages: number; slaConfig?: { target: number; warning: number; breach: number }; followUpConfig?: { warningBeforeHours: number; defaultFollowUpHours: number; autoCreateAfterFirstResponse: boolean }; stageInactivityConfig?: { warningBeforeHours: number; thresholds: Record<string, number>; usingDefault: string[] } }>(`/leads?${p.toString()}`),
    placeholderData: (prev) => prev,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: ["lead", id],
    queryFn: () => api.get<{ lead: any; slaConfig?: { target: number; warning: number; breach: number }; followUpConfig?: { warningBeforeHours: number; defaultFollowUpHours: number; autoCreateAfterFirstResponse: boolean }; stageInactivityConfig?: { warningBeforeHours: number; thresholds: Record<string, number>; usingDefault: string[] } }>(`/leads/${id}`),
    enabled: !!id,
  });
}
export function useLeadActivities(id: string) {
  return useQuery({
    queryKey: ["lead-activities", id],
    queryFn: () => api.get<{ rows: any[] }>(`/leads/${id}/activities`),
    enabled: !!id,
  });
}
export function useLeadTasks(id: string) {
  return useQuery({
    queryKey: ["lead-tasks", id],
    queryFn: () => api.get<{ rows: any[] }>(`/leads/${id}/tasks`),
    enabled: !!id,
  });
}
export function useLeadNotes(id: string) {
  return useQuery({
    queryKey: ["lead-notes", id],
    queryFn: () => api.get<{ rows: any[] }>(`/leads/${id}/notes`),
    enabled: !!id,
  });
}
export function useLeadEvents(id: string) {
  return useQuery({
    queryKey: ["lead-events", id],
    queryFn: () => api.get<{ rows: any[] }>(`/leads/${id}/events`),
    enabled: !!id,
  });
}
export function useLeadDuplicate(id: string) {
  return useQuery({
    queryKey: ["lead-dup", id],
    queryFn: () => api.get<{ hasDuplicates: boolean; matches: any[] }>(`/leads/${id}/duplicate`),
    enabled: !!id,
  });
}

export function useKanban(limit = 50) {
  return useQuery({
    queryKey: ["kanban", limit],
    queryFn: () => api.get<{ pipeline: { id: string; name: string } | null; columns: any[]; totals: { leads: number; estValue: number }; slaConfig?: { target: number; warning: number; breach: number }; followUpConfig?: { warningBeforeHours: number; defaultFollowUpHours: number; autoCreateAfterFirstResponse: boolean }; stageInactivityConfig?: { warningBeforeHours: number; thresholds: Record<string, number>; usingDefault: string[] } }>(`/pipeline/kanban?limit=${limit}`),
    refetchInterval: 30_000,
  });
}
export function usePipeline() {
  return useQuery({
    queryKey: ["pipeline"],
    queryFn: () => api.get<{ pipelines: any[]; sources: any[] }>("/pipeline"),
  });
}
export function useTasks(status?: string[]) {
  const p = new URLSearchParams();
  if (status?.length) p.set("status", status.join(","));
  return useQuery({
    queryKey: ["tasks", p.toString()],
    queryFn: () => api.get<{ rows: any[] }>(`/tasks?${p.toString()}`),
  });
}
export function useInbox(source?: string, unassigned?: boolean) {
  const p = new URLSearchParams();
  if (source) p.set("source", source);
  if (unassigned) p.set("unassigned", "1");
  return useQuery({
    queryKey: ["inbox", p.toString()],
    queryFn: () => api.get<{ rows: any[]; conversations: any[]; total: number }>(`/inbox?${p.toString()}`),
    refetchInterval: 30_000,
  });
}
export function useInboxStats() {
  return useQuery({
    queryKey: ["inbox-stats"],
    queryFn: () => api.get<{ total: number; unassigned: number; last24h: number; bySource: { source: string; count: number }[] }>("/inbox?view=stats"),
    refetchInterval: 60_000,
  });
}
export function useLinkMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => api.patch<{ ok: boolean }>(`/inbox/${id}`, { leadId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox-stats"] });
    },
  });
}
export function useCreateLeadFromMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ leadId: string | null }>(`/inbox/${id}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox-stats"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
export function useSources() {
  return useQuery({ queryKey: ["sources"], queryFn: () => api.get<{ rows: any[] }>("/sources") });
}
export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api.get<{ rows: any[] }>("/tags") });
}
export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => api.get<{ rows: any[] }>("/users") });
}
export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<any>("/settings") });
}

// ---------- EVENT ENGINE v0.14: notifications ----------

export interface NotificationRow {
  id: string;
  userId: string | null;
  eventId: string | null;
  leadId: string | null;
  type: string;
  templateKey: string | null;
  payload: Record<string, unknown> | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  entityType: string | null;
  entityId: string | null;
  deepLink: string | null;
  title: string;
  message: string;
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null } | null;
}

export function useNotifications() {
  // Legacy bell hook — recent rows + server-side unread count.
  return useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () =>
      api.get<{ rows: NotificationRow[]; unread: number }>("/notifications?recent=8&filter=all"),
    refetchInterval: 60_000,
  });
}

export function useNotificationsList(filter: "all" | "unread" | "critical" | "resolved", page: number, limit = 20) {
  return useQuery({
    queryKey: ["notifications", "list", filter, page, limit],
    queryFn: () =>
      api.get<{
        rows: NotificationRow[];
        total: number;
        page: number;
        limit: number;
        pages: number;
        unread: number;
      }>(`/notifications?filter=${filter}&page=${page}&limit=${limit}`),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => api.get<{ count: number }>("/notifications/unread-count"),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/notifications/mark-all-read", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => api.get<{ preferences: Record<string, boolean> }>("/notifications/preferences"),
  });
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: Record<string, boolean>) =>
      api.put<{ ok: boolean; preferences: Record<string, boolean> }>("/notifications/preferences", preferences),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
  });
}

export function useReconcileEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; summary: { scannedLeads: number; eventsCreated: number; notificationsCreated: number; duplicatesSkipped: number; durationMs: number } }>("/events/reconcile", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["domain-events"] });
    },
  });
}

export function useDomainEvents(page = 1, limit = 50) {
  return useQuery({
    queryKey: ["domain-events", page, limit],
    queryFn: () =>
      api.get<{
        rows: { id: string; type: string; entityType: string; entityId: string; occurredAt: string; deduplicationKey: string; processedAt: string | null; payload: Record<string, unknown> | null }[];
        total: number;
      }>(`/events/domain?page=${page}&limit=${limit}`),
  });
}
export function useErpSync() {
  return useQuery({ queryKey: ["erp-sync"], queryFn: () => api.get<{ rows: any[]; events: any[] }>("/erp-sync") });
}
export function useSearch(q: string) {
  return useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<{ rows: any[] }>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
}
export function useAnalytics() {
  return useQuery({
    queryKey: ["analytics"],
    queryFn: () =>
      api.get<{
        totalLeads: number; won: number; lost: number; archived: number;
        conversionRate: number; avgResponseHours: number | null;
        winsBySource: { type: string; name: string; count: number; value: number }[];
        lostReasons: { reason: string; count: number }[];
        days: { date: string; count: number }[];
        trend30: { date: string; count: number; won: number }[];
        respBuckets: Record<string, number>;
        funnel: { stage: string; type: string; color: string | null; count: number; value: number }[];
        openPipelineValue: number; wonValue: number;
        sourceRoi: { type: string; name: string; count: number; won: number; lost: number; value: number; conversion: number }[];
      }>("/analytics"),
  });
}
export function useTeamPerformance() {
  return useQuery({
    queryKey: ["team"],
    queryFn: () =>
      api.get<{
        users: {
          userId: string; name: string; email: string; role: string; avatarColor: string | null;
          totalAssigned: number; activeLeads: number; won: number; lost: number; conversionRate: number;
          overdueTasks: number; openTasks: number; avgResponseHours: number | null; wonValue: number; pipelineValue: number;
        }[];
        totals: Record<string, number>;
      }>("/team"),
  });
}
export function useCustomFields() {
  return useQuery({ queryKey: ["custom-fields"], queryFn: () => api.get<{ rows: any[] }>("/custom-fields") });
}
export function useCreateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; key: string; type: string; options?: string[] }) =>
      api.post<{ field: any }>("/custom-fields", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-fields"] }),
  });
}
export function useDeleteCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/custom-fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-fields"] }),
  });
}
export function useSetCustomValue(fieldId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { leadId: string; valueText?: string | null; valueNumber?: number | null; valueBool?: boolean | null; valueDate?: string | null }) =>
      api.post<{ value: any }>(`/custom-fields/${fieldId}/values`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
    },
  });
}
export function useCreateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { pipelineId: string; name: string; type?: string; color?: string; position?: number }) =>
      api.post<{ stage: any }>("/pipeline/stages", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
}
export function useUpdateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; type?: string; color?: string; position?: number } }) =>
      api.patch<{ stage: any }>(`/pipeline/stages/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
}
export function useDeleteStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/pipeline/stages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
}
export function useSavedFiltersApi() {
  return useQuery({
    queryKey: ["saved-filters-api"],
    queryFn: () => api.get<{ rows: any[] }>("/saved-filters"),
  });
}
export function useCreateSavedFilterApi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; query: Record<string, unknown>; isShared?: boolean }) =>
      api.post<{ filter: any }>("/saved-filters", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters-api"] }),
  });
}
export function useDeleteSavedFilterApi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/saved-filters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters-api"] }),
  });
}
export function useAssignmentRules() {
  return useQuery({
    queryKey: ["assignment-rules"],
    queryFn: () => api.get<{ rows: any[] }>("/assignment-rules"),
  });
}
export function useCreateAssignmentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; sourceId?: string | null; sourceType?: string | null; priority?: string | null; assigneeId: string; enabled?: boolean }) =>
      api.post<{ rule: any }>("/assignment-rules", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignment-rules"] }),
  });
}
export function useUpdateAssignmentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch<{ rule: any }>(`/assignment-rules/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignment-rules"] }),
  });
}
export function useDeleteAssignmentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/assignment-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignment-rules"] }),
  });
}
export function useWebhookEvents(event?: string, limit?: number) {
  const p = new URLSearchParams();
  if (event) p.set("event", event);
  if (limit) p.set("limit", String(limit));
  return useQuery({
    queryKey: ["webhook-events", p.toString()],
    queryFn: () => api.get<{ rows: any[]; byEvent: Record<string, number>; total: number }>(`/webhooks/events?${p.toString()}`),
  });
}
export function useWebhookEndpoints() {
  return useQuery({
    queryKey: ["webhook-endpoints"],
    queryFn: () => api.get<{ rows: any[] }>("/webhooks/endpoints"),
  });
}
export function useCreateWebhookEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; url: string; secret?: string; events?: string; enabled?: boolean }) =>
      api.post<{ endpoint: any }>("/webhooks/endpoints", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhook-endpoints"] }),
  });
}
export function useDeleteWebhookEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/webhooks/endpoints/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhook-endpoints"] }),
  });
}
export function useTestWebhookEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; status?: number; error?: string }>(`/webhooks/endpoints/${id}/test`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhook-endpoints"] }),
  });
}
export function useDuplicatesScan() {
  return useQuery({
    queryKey: ["duplicates-scan"],
    queryFn: () => api.get<{ groups: any[]; total: number; leadsScanned: number }>("/leads/duplicates-scan"),
  });
}

// ---------- mutations ----------

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post<{ lead: any; duplicate?: any; created: boolean }>("/leads", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
    },
  });
}
export function useUpdateLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.patch<{ lead: any }>(`/leads/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
}
export function useChangeStage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stageId: string) => api.patch<{ lead: any }>(`/leads/${id}/stage`, { stageId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
    },
  });
}
// generic: change stage for any lead (used by kanban)
export function useSetLeadStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: string; stageId: string }) =>
      api.patch<{ lead: any }>(`/leads/${leadId}/stage`, { stageId }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["lead", vars.leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
    },
  });
}
export function useAssignLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ownerId: string) => api.patch<{ lead: any }>(`/leads/${id}/assign`, { ownerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
    },
  });
}
export function useArchiveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ lead: any }>(`/leads/${id}/archive`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
    },
  });
}
export function useRestoreLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ lead: any }>(`/leads/${id}/restore`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
}
export function useBulkLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[]; action: "assign" | "stage" | "archive" | "priority"; ownerId?: string; stageId?: string; priority?: string }) =>
      api.post<{ updated: number; total: number }>("/leads/bulk", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
    },
  });
}
export function useMergeLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => api.post<{ lead: any }>(`/leads/${id}/merge`, { sourceId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["lead-dup", id] });
    },
  });
}
export function useRecalcScore(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ lead: { leadScore: number; scoreCategory: string }; result: any }>(`/leads/${id}/score`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
export function useLogActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { type: string; title: string; description?: string }) => api.post<{ activity: any }>(`/leads/${id}/activities`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-activities", id] });
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["lead-events", id] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
      // Qualifying activities (CALL/MESSAGE/EMAIL/MEETING) flip first-response
      // SLA to RESPONDED — refresh every SLA surface without a manual reload.
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
export function useCreateTask(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post<{ task: any }>(id ? `/leads/${id}/tasks` : "/tasks", body),
    onSuccess: () => {
      if (id) {
        qc.invalidateQueries({ queryKey: ["lead-tasks", id] });
        qc.invalidateQueries({ queryKey: ["lead-events", id] });
        qc.invalidateQueries({ queryKey: ["lead-activities", id] });
      }
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
    },
  });
}
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch<{ task: any }>(`/tasks/${id}`, body),
    onSuccess: () => {
      // Task status changes (e.g. completing a follow-up) must refresh every
      // follow-up SLA surface, not just the tasks list.
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["lead-tasks"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["lead-tasks"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// Follow-up SLA operations — schedule / complete / reschedule / cancel.
// Every action refreshes the lead itself, all lead lists, kanban, dashboard
// KPIs, the timeline and the tasks list, so statuses recompute without a
// manual reload.
function invalidateFollowUpSurfaces(qc: ReturnType<typeof useQueryClient>, leadId?: string) {
  if (leadId) {
    qc.invalidateQueries({ queryKey: ["lead", leadId] });
    qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
    qc.invalidateQueries({ queryKey: ["lead-tasks", leadId] });
    qc.invalidateQueries({ queryKey: ["lead-events", leadId] });
  } else {
    qc.invalidateQueries({ queryKey: ["lead"] });
    qc.invalidateQueries({ queryKey: ["lead-activities"] });
    qc.invalidateQueries({ queryKey: ["lead-tasks"] });
    qc.invalidateQueries({ queryKey: ["lead-events"] });
  }
  qc.invalidateQueries({ queryKey: ["leads"] });
  qc.invalidateQueries({ queryKey: ["kanban"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  qc.invalidateQueries({ queryKey: ["tasks"] });
  qc.invalidateQueries({ queryKey: ["lost-detector"] });
}

export function useScheduleFollowUp(leadId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dueAt, note }: { id: string; dueAt: string; note?: string }) =>
      api.post<{ task: any }>(`/leads/${id}/followup`, { dueAt, note }),
    onSuccess: () => invalidateFollowUpSurfaces(qc, leadId),
  });
}

export function useFollowUpAction(leadId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      dueAt,
      note,
    }: {
      id: string;
      action: "complete" | "reschedule" | "cancel";
      dueAt?: string;
      note?: string;
    }) => api.patch<{ task: any }>(`/leads/${id}/followup`, { action, dueAt, note }),
    onSuccess: () => invalidateFollowUpSurfaces(qc, leadId),
  });
}
export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.post<{ note: any }>(`/leads/${id}/notes`, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-notes", id] });
      qc.invalidateQueries({ queryKey: ["lead-events", id] });
    },
  });
}
export function useSyncErp(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ sync: any }>(id ? `/leads/${id}/erp-sync` : "/erp-sync", id ? {} : { leadId: id }),
    onSuccess: () => {
      if (id) qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["erp-sync"] });
    },
  });
}
export function useIngestAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post<{ leadId: string; auditId: string; created: boolean }>("/business-audit", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["lost-detector"] });
    },
  });
}
export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { csv: string; mapping?: Record<string, string>; sourceType?: string }) =>
      api.post<{ imported: { created: number; updated: number; skipped: number; errors: number }; total: number }>("/import", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
}
export function useSwitchUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post<{ ok: boolean; user: any }>("/session", { userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}
export function useRunLostDetector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ flags: any[]; leadsNeedingAttention: number }>("/lost-detector", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lost-detector"] }),
  });
}
export function useSeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ seeded: boolean; orgId: string | null }>("/seed", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
    },
  });
}

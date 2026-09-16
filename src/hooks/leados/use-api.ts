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
        metrics: { newLeads: number; unassigned: number; overdueFollowups: number; qualified: number; meetings: number; proposals: number; won: number; lost: number; totalActive: number };
        bySource: { source: string; type: string; count: number }[];
        byStage: { stage: string; type: string; count: number; color: string | null }[];
        recent: any[];
        overdueTasks: any[];
        activity: any[];
        attention: any[];
        urgentUnassigned: number;
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
    queryFn: () => api.get<{ rows: any[]; total: number; page: number; limit: number; pages: number }>(`/leads?${p.toString()}`),
    placeholderData: (prev) => prev,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: ["lead", id],
    queryFn: () => api.get<{ lead: any }>(`/leads/${id}`),
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
    queryFn: () => api.get<{ pipeline: { id: string; name: string } | null; columns: any[]; totals: { leads: number; estValue: number } }>(`/pipeline/kanban?limit=${limit}`),
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
export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ rows: any[]; unread: number }>("/notifications"),
    refetchInterval: 60_000,
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
      }
      qc.invalidateQueries({ queryKey: ["tasks"] });
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
      qc.invalidateQueries({ queryKey: ["tasks"] });
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
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
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

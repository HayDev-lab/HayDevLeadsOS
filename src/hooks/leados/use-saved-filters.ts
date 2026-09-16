"use client";

import { useCallback, useEffect, useState } from "react";
import { useSavedFiltersApi, useCreateSavedFilterApi, useDeleteSavedFilterApi } from "@/hooks/leados/use-api";

export interface SavedFilter {
  id: string;
  name: string;
  query: Record<string, unknown>;
  isShared?: boolean;
  createdAt: number;
}

const KEY = "leados_saved_filters";

function loadLocal(): SavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedFilter[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(filters: SavedFilter[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(filters));
  } catch {}
}

/**
 * Hybrid saved filters: uses backend API when authenticated, falls back to
 * localStorage when not (e.g. before session loads). Merges both sources.
 */
export function useSavedFilters() {
  const apiQuery = useSavedFiltersApi();
  const createApi = useCreateSavedFilterApi();
  const deleteApi = useDeleteSavedFilterApi();
  const [localFilters, setLocalFilters] = useState<SavedFilter[]>(() => loadLocal());

  // merge: backend filters + local (deduped by name+query hash)
  const apiFilters: SavedFilter[] = (apiQuery.data?.rows ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    query: r.query as Record<string, unknown>,
    isShared: r.isShared,
    createdAt: new Date(r.createdAt).getTime(),
  }));

  const apiKeys = new Set(apiFilters.map((f) => f.name + JSON.stringify(f.query)));
  const merged = [...apiFilters, ...localFilters.filter((f) => !apiKeys.has(f.name + JSON.stringify(f.query)))];

  const add = useCallback((name: string, query: Record<string, unknown>) => {
    // try backend first
    if (apiQuery.data) {
      createApi.mutate(
        { name, query, isShared: false },
        {
          onSuccess: () => {},
          onError: () => {
            // fallback to local
            const f: SavedFilter = { id: `local_${Date.now()}`, name, query, createdAt: Date.now() };
            setLocalFilters((cur) => {
              const next = [...cur, f];
              saveLocal(next);
              return next;
            });
          },
        }
      );
      return { id: `pending_${Date.now()}`, name, query, createdAt: Date.now() } as SavedFilter;
    }
    const f: SavedFilter = { id: `local_${Date.now()}`, name, query, createdAt: Date.now() };
    setLocalFilters((cur) => {
      const next = [...cur, f];
      saveLocal(next);
      return next;
    });
    return f;
  }, [apiQuery.data, createApi]);

  const remove = useCallback((id: string) => {
    if (id.startsWith("local_") || id.startsWith("pending_")) {
      setLocalFilters((cur) => {
        const next = cur.filter((f) => f.id !== id);
        saveLocal(next);
        return next;
      });
    } else {
      deleteApi.mutate(id);
    }
  }, [deleteApi]);

  return { filters: merged, add, remove };
}

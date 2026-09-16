"use client";

import { useCallback, useState } from "react";

export interface SavedFilter {
  id: string;
  name: string;
  query: Record<string, unknown>;
  createdAt: number;
}

const KEY = "leados_saved_filters";

function load(): SavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedFilter[]) : [];
  } catch {
    return [];
  }
}

function save(filters: SavedFilter[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(filters));
  } catch {}
}

export function useSavedFilters() {
  const [filters, setFilters] = useState<SavedFilter[]>(() => load());

  const add = useCallback((name: string, query: Record<string, unknown>) => {
    const f: SavedFilter = { id: `sf_${Date.now()}`, name, query, createdAt: Date.now() };
    setFilters((cur) => {
      const next = [...cur, f];
      save(next);
      return next;
    });
    return f;
  }, []);

  const remove = useCallback((id: string) => {
    setFilters((cur) => {
      const next = cur.filter((f) => f.id !== id);
      save(next);
      return next;
    });
  }, []);

  return { filters, add, remove };
}

// HAYDEV LEADOS — leads list state preservation (v0.23).
// Navigating leads → lead detail → back used to reset every filter/sort to
// defaults, because LeadsView remounts on every hash-route change. This module
// snapshots the FILTER STATE (not the transient page number, not selection)
// into sessionStorage so returning to #/leads restores the working context.
//
// Design rules:
// - sessionStorage (per tab) — never localStorage: a second tab comparing
//   different filter sets must not fight over one snapshot.
// - Deep links still win: explicit route params (e.g. #/leads?overdue=1 from
//   the dashboard "needs attention" widget) are applied AFTER the snapshot
//   in LeadsView's initializers, so navigation intent is never ignored.
// - Explicit "Clear" wipes the snapshot (reset()).
// - Guarded JSON parse — a corrupted/foreign value must never crash the view.

export interface LeadsListState {
  q: string;
  sourceId: string;
  ownerId: string;
  stageId: string;
  priority: string[];
  overdue: boolean;
  unassigned: boolean;
  slaFilter: string;
  followUpFilter: string;
  stageHealthFilter: string;
  sort: string;
  showArchived: boolean;
}

const STORAGE_KEY = "leados:leads-state";

export function loadLeadsState(): Partial<LeadsListState> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LeadsListState>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    // sanitize: only known string/bool/array-of-string fields survive
    const out: Partial<LeadsListState> = {};
    const strKeys = ["q", "sourceId", "ownerId", "stageId", "slaFilter", "followUpFilter", "stageHealthFilter", "sort"] as const;
    for (const k of strKeys) {
      const v = parsed[k];
      if (typeof v === "string") (out as Record<string, unknown>)[k] = v;
    }
    for (const k of ["overdue", "unassigned", "showArchived"] as const) {
      const v = parsed[k];
      if (typeof v === "boolean") (out as Record<string, unknown>)[k] = v;
    }
    if (Array.isArray(parsed.priority)) out.priority = parsed.priority.filter((x): x is string => typeof x === "string");
    return out;
  } catch {
    return null;
  }
}

export function saveLeadsState(state: LeadsListState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota/private-mode — state preservation is best-effort */
  }
}

export function clearLeadsState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

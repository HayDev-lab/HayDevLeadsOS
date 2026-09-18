// HAYDEV LEADOS — RECENTLY-VIEWED LEADS (v0.20).
//
// Client-side, per-browser view history for the command palette. Pure
// localStorage utility — no server state, no PII beyond what the user
// already sees (name/company/phone fragment are stored to render the
// palette rows without extra API calls).

export type RecentLeadEntry = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  phone: string | null;
  avatarColor: string | null;
  stageName: string | null;
  at: number;
};

const KEY = "leados:recent-leads";
const MAX = 5;

function isEntry(v: unknown): v is RecentLeadEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === "string" && typeof e.at === "number";
}

export function getRecentLeads(): RecentLeadEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecentLead(entry: Omit<RecentLeadEntry, "at">): void {
  if (typeof window === "undefined") return;
  try {
    const rest = getRecentLeads().filter((e) => e.id !== entry.id);
    const next = [{ ...entry, at: Date.now() }, ...rest].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / private mode — history is best-effort, never fatal */
  }
}

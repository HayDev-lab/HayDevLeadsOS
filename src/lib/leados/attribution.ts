// Source attribution helpers + CSV parsing/serialization.

import { db } from "@/lib/db";

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  landing_page?: string;
  referrer?: string;
}

export function parseUtm(query: URLSearchParams | Record<string, string | string[] | undefined>): UtmParams {
  const get = (k: string): string | undefined => {
    if (query instanceof URLSearchParams) return query.get(k) ?? undefined;
    const v = query[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const out: UtmParams = {};
  if (get("utm_source")) out.utm_source = get("utm_source");
  if (get("utm_medium")) out.utm_medium = get("utm_medium");
  if (get("utm_campaign")) out.utm_campaign = get("utm_campaign");
  if (get("utm_content")) out.utm_content = get("utm_content");
  if (get("utm_term")) out.utm_term = get("utm_term");
  if (get("landing_page")) out.landing_page = get("landing_page");
  if (get("referrer") || get("http_referer")) out.referrer = get("referrer") ?? get("http_referer");
  return out;
}

export async function recordAttribution(leadId: string, source: string | null, utm: UtmParams) {
  if (!utm.utm_source && !utm.utm_campaign && !utm.utm_medium && !utm.landing_page && !utm.referrer && !source) {
    return null;
  }
  return db.sourceAttribution.create({
    data: {
      leadId,
      source,
      campaign: utm.utm_campaign ?? null,
      utmSource: utm.utm_source ?? null,
      utmMedium: utm.utm_medium ?? null,
      utmContent: utm.utm_content ?? null,
      utmTerm: utm.utm_term ?? null,
      landingPage: utm.landing_page ?? null,
      referrer: utm.referrer ?? null,
    },
  });
}

// --- CSV ---------------------------------------------------------------------

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Array.from(
    rows.reduce((s, r) => {
      Object.keys(r).forEach((k) => s.add(k));
      return s;
    }, new Set<string>())
  );
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n");
}

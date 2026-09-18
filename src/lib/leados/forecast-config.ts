// HAYDEV LEADOS — forecast commit threshold (v0.23).
// The revenue-forecast "commit" figure counts stages whose win probability
// is at or above this floor. It used to be hardcoded at 60%; it is now an
// org-scoped Setting so sales managers can tune how conservative "commit"
// is for their pipeline maturity.
//
// Design notes:
// - The analytics route is already cached (v0.21 api-cache), so the service
//   reads the Setting directly per analytics computation — no extra cache
//   layer needed here.
// - Validation is shared between the settings route (server) and the UI
//   (client hint) so the contract lives in exactly one place.

export const FORECAST_SETTING_KEY = "forecast_commit_threshold";
export const DEFAULT_FORECAST_COMMIT_THRESHOLD = 60;

export function validateForecastThreshold(value: unknown): { ok: true; threshold: number } | { ok: false; errors: string[] } {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return { ok: false, errors: ["forecast threshold must be a number"] };
  const threshold = Math.round(n);
  if (threshold < 1 || threshold > 99) return { ok: false, errors: ["forecast threshold must be between 1 and 99"] };
  return { ok: true, threshold };
}

/** Client-safe parse of the raw Setting rows (settings GET returns them all). */
export function readForecastThreshold(settingRows: { key: string; value: unknown }[] | undefined | null): number {
  const row = settingRows?.find((r) => r.key === FORECAST_SETTING_KEY);
  const v = row?.value;
  if (typeof v === "number" && Number.isFinite(v)) return Math.min(99, Math.max(1, Math.round(v)));
  return DEFAULT_FORECAST_COMMIT_THRESHOLD;
}

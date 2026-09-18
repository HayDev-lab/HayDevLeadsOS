// META LEAD ADS — centralized Graph API client (v0.19).
//
// EVERY real Meta network call in LeadOS goes through this file. It owns:
//   • the Graph version (META_GRAPH_API_VERSION only);
//   • auth (access token param);
//   • timeout (AbortSignal);
//   • response parsing + error classification (MetaError taxonomy);
//   • NO token/PII logging (errors carry codes and neutral text only).
//
// Retries are NOT automatic here — the caller (worker) owns bounded retry
// policy, because idempotency context lives above the transport.

import { GRAPH_BASE_URL, getMetaConfig } from "./config";
import { MetaError, META_ERROR_CODE, classifyGraphError } from "./errors";

export interface GraphRequestOptions {
  accessToken: string;
  path: string; // e.g. "/{leadgen-id}" or "/me/accounts"
  params?: Record<string, string>;
  method?: "GET" | "POST" | "DELETE";
  /** Extra body fields for POST (form-encoded). */
  postBody?: Record<string, string>;
  timeoutMs?: number;
}

export interface GraphResult<T> {
  status: number;
  data: T;
}

export async function graphRequest<T = unknown>(opts: GraphRequestOptions): Promise<GraphResult<T>> {
  const cfg = getMetaConfig();
  const url = new URL(`${GRAPH_BASE_URL}/${cfg.graphApiVersion}${opts.path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);

  let body: string | undefined;
  if (opts.method === "POST" && opts.postBody) {
    body = new URLSearchParams({ access_token: opts.accessToken, ...opts.postBody }).toString();
    url.searchParams.delete("access_token");
  } else {
    url.searchParams.set("access_token", opts.accessToken);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (e) {
    const err = e as Error;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new MetaError(META_ERROR_CODE.META_TEMPORARY_ERROR, "Graph request timeout", { retryable: true });
    }
    throw new MetaError(META_ERROR_CODE.META_TEMPORARY_ERROR, "Network failure", { retryable: true });
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (res.ok) throw new MetaError(META_ERROR_CODE.META_INVALID_RESPONSE, `Non-JSON success (HTTP ${res.status})`);
    data = {};
  }
  if (!res.ok) throw classifyGraphError(res.status, data);
  return { status: res.status, data: data as T };
}

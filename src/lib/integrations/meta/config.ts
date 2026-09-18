// META LEAD ADS — configuration (v0.19).
//
// ALL Meta Graph API calls go through the centralized client, and the client
// reads its version ONLY from here (spec: "Версия только через
// META_GRAPH_API_VERSION"). Default = v25.0, the current stable Graph API
// version (released 2026-02-18, verified against Meta's changelog).
//
// This module is PURE (no DB, no React) so tests can inject env values.

export const DEFAULT_GRAPH_API_VERSION = "v25.0";
export const GRAPH_BASE_URL = "https://graph.facebook.com";

export interface MetaConfig {
  appId: string | null;
  appSecret: string | null;
  graphApiVersion: string;
  webhookVerifyToken: string | null;
  redirectUri: string | null;
  encryptionKey: string | null;
  /** Demo mode (LEADOS_DEMO=true): ZERO network calls to graph.facebook.com. */
  demo: boolean;
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function getMetaConfig(): MetaConfig {
  const version = env("META_GRAPH_API_VERSION") ?? DEFAULT_GRAPH_API_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error(`META_GRAPH_API_VERSION must look like "v25.0", got "${version}"`);
  }
  return {
    appId: env("META_APP_ID") ?? null,
    appSecret: env("META_APP_SECRET") ?? null,
    graphApiVersion: version,
    webhookVerifyToken: env("META_WEBHOOK_VERIFY_TOKEN") ?? null,
    redirectUri: env("META_REDIRECT_URI") ?? null,
    encryptionKey: env("INTEGRATION_ENCRYPTION_KEY") ?? null,
    demo: process.env.LEADOS_DEMO === "true",
  };
}

/** OAuth scopes/permissions required for Lead Ads ingestion (current docs):
 *  leads_retrieval, pages_show_list, pages_manage_metadata,
 *  pages_read_engagement, ads_management (ads_management only needed when
 *  forms are attached to ads; requested for full retrieval context). */
export const META_OAUTH_SCOPES = [
  "leads_retrieval",
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "ads_management",
] as const;

/** True when the REAL OAuth flow is usable (demo mode never needs it). */
export function oauthConfigured(cfg: MetaConfig): boolean {
  return Boolean(cfg.appId && cfg.appSecret && cfg.redirectUri);
}

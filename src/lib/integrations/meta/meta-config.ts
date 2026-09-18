/**
 * Meta Lead Ads Integration — Configuration
 * 
 * All Meta-related environment variables are accessed through this module.
 * Never access process.env.META_* directly in other files.
 */

import { z } from "zod";

const MetaConfigSchema = z.object({
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  graphApiVersion: z.string().default("v26.0"),
  webhookVerifyToken: z.string().optional(),
  redirectUri: z.string().optional(),
});

export type MetaConfig = z.infer<typeof MetaConfigSchema>;

function getMetaConfig(): MetaConfig {
  const result = MetaConfigSchema.safeParse({
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    graphApiVersion: process.env.META_GRAPH_API_VERSION || "v26.0",
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
    redirectUri: process.env.META_REDIRECT_URI,
  });

  if (!result.success) {
    // Return partial config - validation happens at usage time
    return {
      appId: process.env.META_APP_ID,
      appSecret: process.env.META_APP_SECRET,
      graphApiVersion: process.env.META_GRAPH_API_VERSION || "v26.0",
      webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
      redirectUri: process.env.META_REDIRECT_URI,
    };
  }

  return result.data;
}

export const metaConfig = getMetaConfig();

/**
 * Check if Meta integration is configured for production use.
 * In demo mode, real credentials are not required.
 */
export function isMetaConfigured(): boolean {
  if (process.env.LEADOS_DEMO === "true") {
    return true; // Demo mode doesn't need real credentials
  }
  return !!(metaConfig.appId && metaConfig.appSecret);
}

/**
 * Get the base Graph API URL with version.
 */
export function getGraphApiUrl(path: string): string {
  const version = metaConfig.graphApiVersion;
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `https://graph.facebook.com/${version}${normalizedPath}`;
}

/**
 * Validate that required credentials exist for production mode.
 * Throws an error if configuration is missing in non-demo mode.
 */
export function validateMetaConfig(): void {
  if (process.env.LEADOS_DEMO === "true") {
    return; // Demo mode doesn't need real credentials
  }

  const errors: string[] = [];

  if (!metaConfig.appId) {
    errors.push("META_APP_ID is required");
  }
  if (!metaConfig.appSecret) {
    errors.push("META_APP_SECRET is required");
  }
  if (!metaConfig.webhookVerifyToken) {
    errors.push("META_WEBHOOK_VERIFY_TOKEN is required");
  }

  if (errors.length > 0) {
    throw new Error(
      `Meta integration is not configured on this LeadOS deployment:\n${errors.join("\n")}`
    );
  }
}

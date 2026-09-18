/**
 * Meta Lead Ads Integration — Graph API Client
 * 
 * Centralized HTTP client for Meta Graph API interactions.
 * Handles URL construction, authentication, timeouts, error normalization.
 */

import { metaConfig, getGraphApiUrl } from "./meta-config";
import {
  MetaIntegrationError,
  createMetaErrorFromApiResponse,
} from "./meta-errors";

export interface GraphApiResponse<T> {
  data: T;
  paging?: {
    previous?: string;
    next?: string;
    cursors?: {
      before: string;
      after: string;
    };
  };
}

export interface RequestOptions {
  accessToken?: string;
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Build URL with query parameters.
 */
function buildUrl(
  baseUrl: string,
  params: Record<string, string | number | boolean | undefined>
): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.append(key, String(value));
    }
  });
  return url.toString();
}

/**
 * Execute a request to the Meta Graph API.
 */
async function graphRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    accessToken,
    method = "GET",
    params = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  // Validate configuration in non-demo mode
  if (process.env.LEADOS_DEMO !== "true" && !metaConfig.appId) {
    throw new MetaIntegrationError(
      "Meta integration is not configured on this LeadOS deployment.",
      "META_CONFIG_ERROR"
    );
  }

  // Build URL
  let url = getGraphApiUrl(path);

  // Add access token and params
  const allParams: Record<string, string | number | boolean> = {};
  if (accessToken) {
    allParams.access_token = accessToken;
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      allParams[key] = value;
    }
  }

  url = buildUrl(url, allParams);

  // Prepare fetch options
  const fetchOptions: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body && method !== "GET") {
    fetchOptions.body = JSON.stringify(body);
  }

  // Execute request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Parse response
    const responseData = await response.json().catch(() => ({}));

    // Handle Meta API errors
    if (!response.ok) {
      const apiError = responseData.error || {};
      throw createMetaErrorFromApiResponse(apiError, `HTTP ${response.status}`);
    }

    // Check for error in successful response (Meta sometimes returns errors with 200)
    if (responseData.error) {
      throw createMetaErrorFromApiResponse(responseData.error);
    }

    return responseData as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof MetaIntegrationError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new MetaIntegrationError(
        "Request timeout",
        "META_TEMPORARY_ERROR"
      );
    }

    throw new MetaIntegrationError(
      `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      "META_TEMPORARY_ERROR",
      { cause: error }
    );
  }
}

/**
 * GET request to Graph API.
 */
export async function graphGet<T>(
  path: string,
  options: Omit<RequestOptions, "method" | "body"> = {}
): Promise<T> {
  return graphRequest<T>(path, { ...options, method: "GET" });
}

/**
 * POST request to Graph API.
 */
export async function graphPost<T>(
  path: string,
  options: Omit<RequestOptions, "method"> = {}
): Promise<T> {
  return graphRequest<T>(path, { ...options, method: "POST" });
}

/**
 * DELETE request to Graph API.
 */
export async function graphDelete<T>(
  path: string,
  options: Omit<RequestOptions, "method" | "body"> = {}
): Promise<T> {
  return graphRequest<T>(path, { ...options, method: "DELETE" });
}

/**
 * Fetch a lead by ID from Meta Lead Ads.
 * Returns lead details including field_data.
 */
export async function fetchLeadDetails(
  leadgenId: string,
  accessToken: string
): Promise<{
  id: string;
  created_time: string;
  form_id: string;
  field_data?: Array<{ name: string; values: string[] }>;
  ad_id?: string;
  campaign_id?: string;
  adset_id?: string;
}> {
  return graphGet(`/leadgen_leads/${leadgenId}`, {
    accessToken,
    params: {
      fields: "id,created_time,form_id,field_data,ad_id,campaign_id,adset_id",
    },
  });
}

/**
 * Get Page details.
 */
export async function fetchPageDetails(
  pageId: string,
  accessToken: string
): Promise<{
  id: string;
  name: string;
}> {
  return graphGet(`/${pageId}`, {
    accessToken,
    params: {
      fields: "id,name",
    },
  });
}

/**
 * Get lead forms for a Page.
 */
export async function fetchPageLeadForms(
  pageId: string,
  accessToken: string
): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    created_time?: string;
  }>
> {
  const response = await graphGet<{
    data: Array<{
      id: string;
      name: string;
      status: string;
      created_time?: string;
    }>;
  }>(`/${pageId}/leadgen_forms`, {
    accessToken,
    params: {
      fields: "id,name,status,created_time",
    },
  });

  return response.data || [];
}

/**
 * Subscribe a Page to leadgen webhooks.
 */
export async function subscribePageToLeadgen(
  pageId: string,
  accessToken: string,
  callbackUrl: string,
  verifyToken: string
): Promise<{ success: boolean }> {
  return graphPost(`/ ${pageId}/subscribed_apps`, {
    accessToken,
    body: {
      subscribed_fields: "leadgen",
      callback_url: callbackUrl,
      verify_token: verifyToken,
    },
  });
}

/**
 * Check if a Page is subscribed to leadgen webhooks.
 */
export async function checkPageSubscription(
  pageId: string,
  accessToken: string
): Promise<{
  subscribed: boolean;
  subscribedFields?: string[];
}> {
  try {
    const response = await graphGet<{
      data: Array<{
        id: string;
        subscribed_fields?: string[];
      }>;
    }>(`/${pageId}/subscribed_apps`, {
      accessToken,
      params: {
        fields: "id,subscribed_fields",
      },
    });

    const appSubscription = response.data?.find(
      (app) => app.id === metaConfig.appId
    );

    if (!appSubscription) {
      return { subscribed: false };
    }

    const subscribedFields = appSubscription.subscribed_fields || [];
    return {
      subscribed: subscribedFields.includes("leadgen"),
      subscribedFields,
    };
  } catch (error) {
    if (error instanceof MetaIntegrationError && error.type === "META_NOT_FOUND") {
      return { subscribed: false };
    }
    throw error;
  }
}

/**
 * Unsubscribe a Page from leadgen webhooks.
 */
export async function unsubscribePageFromLeadgen(
  pageId: string,
  accessToken: string
): Promise<{ success: boolean }> {
  try {
    return await graphDelete(`/ ${pageId}/subscribed_apps`, {
      accessToken,
      params: {
        subscribed_fields: "leadgen",
      },
    });
  } catch (error) {
    // Ignore errors during unsubscribe (app may already be unsubscribed)
    return { success: false };
  }
}

/**
 * Get user's Pages that they can manage.
 */
export async function fetchUserPages(
  accessToken: string
): Promise<
  Array<{
    id: string;
    name: string;
    accessToken: string;
    permissions: string[];
  }>
> {
  const response = await graphGet<{
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      permissions: string[];
    }>;
  }>("/me/accounts", {
    accessToken,
    params: {
      fields: "id,name,access_token,permissions",
    },
  });

  return (response.data || []).map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
    permissions: page.permissions || [],
  }));
}

/**
 * Debug/validate an access token.
 */
export async function debugToken(
  accessToken: string
): Promise<{
  isValid: boolean;
  userId?: string;
  expiresAt?: number;
  scopes?: string[];
}> {
  try {
    const response = await graphGet<{
      data: {
        user_id: string;
        expires_at: number;
        scopes: string[];
        is_valid: boolean;
      };
    }>("/debug_token", {
      params: {
        input_token: accessToken,
        access_token: `${metaConfig.appId}|${metaConfig.appSecret}`,
      },
    });

    return {
      isValid: response.data.is_valid,
      userId: response.data.user_id,
      expiresAt: response.data.expires_at,
      scopes: response.data.scopes,
    };
  } catch (error) {
    return { isValid: false };
  }
}

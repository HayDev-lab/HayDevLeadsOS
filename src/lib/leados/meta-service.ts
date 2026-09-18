// HAYDEV LEADOS — META LEAD ADS SERVICE (v0.19).
//
// TENANT SECURITY (P0): "valid UUID ≠ authorized entity". EVERY connection/
// page/form/mapping operation re-validates organization ownership IN THE
// WHERE CLAUSE — forged foreign IDs simply match nothing (404).
//   • MetaConnection / Page / Form  → belong to session.orgId
//   • defaultOwnerId                → ACTIVE OrganizationMember of this org
//   • defaultStageId                → stage of a pipeline of this org
//   • leadSourceId                  → LeadSource of this org
// WEBHOOK ROUTING: pageId → MetaPageConnection → organization. The payload
// NEVER supplies organizationId as truth.

import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import { getMetaConfig, META_OAUTH_SCOPES, oauthConfigured } from "@/lib/integrations/meta/config";
import { getMetaProvider, type MetaProvider } from "@/lib/integrations/meta/provider";
import { encryptToken, decryptToken } from "@/lib/integrations/meta/encryption";
import { MetaError, META_ERROR_CODE } from "@/lib/integrations/meta/errors";
import type { LeadgenChange } from "@/lib/integrations/meta/webhook";
import type { MappingRule } from "@/lib/integrations/meta/lead-mapper";
import { invalidateOrgCache } from "./api-cache";

export const META_CONNECTION_STATUS = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTED: "CONNECTED",
  REAUTH_REQUIRED: "REAUTH_REQUIRED",
  ERROR: "ERROR",
} as const;

export const META_EVENT_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  UNMAPPED_PAGE: "UNMAPPED_PAGE",
  UNMAPPED_FORM: "UNMAPPED_FORM",
} as const;

// ---------------------------------------------------------------------------
// v0.19.2 — META PAGE ROUTING (hardening §18–19)
// ---------------------------------------------------------------------------

/** Deterministic webhook routing: ONE Meta Page ID → ONE LeadOS organization
 *  (DB unique on MetaPageConnection.pageId — the invariant is enforced at
 *  the storage layer, verified duplicate-free before it was applied).
 *
 *  - exactly ONE route per pageId (findUnique — never findFirst, never a guess);
 *  - unknown page → null (caller parks UNMAPPED_PAGE — no org leak);
 *  - the payload NEVER supplies an organizationId as truth.
 */
export async function resolveMetaPageRoute(
  pageId: string
): Promise<{ organizationId: string; pageConnectionId: string } | null> {
  const page = await db.metaPageConnection.findUnique({ where: { pageId } });
  if (!page) return null;
  return { organizationId: page.organizationId, pageConnectionId: page.id };
}

const OAUTH_STATE_TTL_MS = 10 * 60_000;

function assertOrgScoped<T extends { organizationId: string | null }>(row: T | null | undefined, orgId: string, what: string): T {
  if (!row || row.organizationId !== orgId) {
    // Forged foreign ID or missing row — identical observable outcome (404).
    throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, `${what} not found for this organization`);
  }
  return row;
}

async function requireConnection(orgId: string) {
  const conn = await db.metaConnection.findUnique({ where: { organizationId: orgId } });
  if (!conn) throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "Meta connection not found (connect first)");
  return conn;
}

/** Validated, decrypted connection + provider. Throws typed errors on
 *  REAUTH_REQUIRED / disconnected states. */
export async function requireActiveConnection(orgId: string) {
  const conn = await requireConnection(orgId);
  if (conn.status === META_CONNECTION_STATUS.REAUTH_REQUIRED) {
    throw new MetaError(META_ERROR_CODE.META_TOKEN_EXPIRED, "Re-authorization required");
  }
  if (conn.status !== META_CONNECTION_STATUS.CONNECTED || !conn.tokenEncrypted) {
    throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "Meta is not connected");
  }
  let accessToken: string;
  try {
    accessToken = decryptToken(conn.tokenEncrypted);
  } catch {
    await db.metaConnection.update({ where: { id: conn.id }, data: { status: META_CONNECTION_STATUS.REAUTH_REQUIRED, authError: "Token undecryptable (key rotated?)" } });
    throw new MetaError(META_ERROR_CODE.META_TOKEN_EXPIRED, "Stored token cannot be decrypted");
  }
  return { conn, accessToken, provider: getMetaProvider() };
}

// ---------------------------------------------------------------------------
// CONNECT / DISCONNECT / OAUTH
// ---------------------------------------------------------------------------

export async function connectDemo(orgId: string, userId: string) {
  if (getMetaConfig().demo !== true) {
    throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "Demo connect requires LEADOS_DEMO=true");
  }
  const provider = getMetaProvider();
  const tokens = await provider.exchangeCode("demo", "");
  const pages = await provider.listPages(tokens.accessToken);
  await upsertConnection(orgId, {
    appMode: "DEMO",
    status: META_CONNECTION_STATUS.CONNECTED,
    accessToken: tokens.accessToken,
    displayName: "HayDev Demo Meta App",
    userId,
  });
  await syncPages(orgId, pages);
  return getStatus(orgId);
}

async function upsertConnection(
  orgId: string,
  data: { appMode: string; status: string; accessToken: string; displayName?: string; userId: string; scopes?: string | null }
) {
  const encrypted = encryptToken(data.accessToken);
  await db.metaConnection.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      appMode: data.appMode,
      status: data.status,
      tokenEncrypted: encrypted,
      displayName: data.displayName ?? null,
      scopes: data.scopes ?? null,
      connectedAt: new Date(),
      authError: null,
    },
    update: {
      appMode: data.appMode,
      status: data.status,
      tokenEncrypted: encrypted,
      displayName: data.displayName ?? null,
      scopes: data.scopes ?? null,
      connectedAt: new Date(),
      authError: null,
    },
  });
}

/** Start the real OAuth flow: returns the authorize URL. State is
 *  cryptographically random, org+user bound, expiring, single-use. */
export async function startOAuth(orgId: string, userId: string, redirectTo?: string) {
  const cfg = getMetaConfig();
  if (!oauthConfigured(cfg)) {
    throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "OAuth not configured: set META_APP_ID, META_APP_SECRET, META_REDIRECT_URI");
  }
  const state = randomBytes(32).toString("base64url");
  await db.metaOAuthState.create({
    data: {
      organizationId: orgId,
      userId,
      state,
      redirectTo: redirectTo ?? "#/settings",
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    },
  });
  const url = new URL(`https://www.facebook.com/${cfg.graphApiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", cfg.appId!);
  url.searchParams.set("redirect_uri", cfg.redirectUri!);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_OAUTH_SCOPES.join(","));
  return { authorizeUrl: url.toString() };
}

/** OAuth callback: validates state (single-use, expiry, org/user binding),
 *  exchanges the code, stores the encrypted token, syncs pages. */
export async function handleOAuthCallback(code: string, state: string) {
  const row = await db.metaOAuthState.findUnique({ where: { state } });
  if (!row) throw new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "Unknown OAuth state");
  if (row.consumedAt) throw new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "OAuth state already used (replay)");
  if (row.expiresAt.getTime() < Date.now()) throw new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "OAuth state expired");
  // Single-use: claim atomically — concurrent callbacks with the same state lose.
  const claimed = await db.metaOAuthState.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) throw new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "OAuth state replay detected");

  const cfg = getMetaConfig();
  const provider = getMetaProvider();
  const tokens = await provider.exchangeCode(code, cfg.redirectUri!);
  await upsertConnection(row.organizationId, {
    appMode: "REAL",
    status: META_CONNECTION_STATUS.CONNECTED,
    accessToken: tokens.accessToken,
    userId: row.userId,
    scopes: META_OAUTH_SCOPES.join(","),
  });
  await syncPages(row.organizationId);
  return { organizationId: row.organizationId, redirectTo: row.redirectTo ?? "#/settings" };
}

/** Disconnect: stops NEW leads (subscription removed, token material cleared)
 *  but keeps forms/mappings/history/leads — attribution survives. */
export async function disconnect(orgId: string) {
  const conn = await requireConnection(orgId);
  const provider = getMetaProvider();
  const pages = await db.metaPageConnection.findMany({ where: { organizationId: orgId } });
  if (conn.tokenEncrypted && conn.appMode === "REAL") {
    // Best-effort unsubscribe; token problems must not block disconnect.
    for (const p of pages) {
      try {
        const pageToken = await pageTokenFor(provider, conn, p.pageId);
        if (pageToken) await provider.unsubscribePage(pageToken, p.pageId);
      } catch { /* best-effort */ }
    }
  }
  await db.metaPageConnection.updateMany({ where: { organizationId: orgId }, data: { subscriptionStatus: "NOT_SUBSCRIBED", subscriptionError: null } });
  await db.metaConnection.update({
    where: { id: conn.id },
    data: { status: META_CONNECTION_STATUS.DISCONNECTED, tokenEncrypted: null, tokenExpiresAt: null, authError: null },
  });
  invalidateOrgCache(orgId);
  return { ok: true };
}

async function pageTokenFor(provider: MetaProvider, conn: { tokenEncrypted: string | null }, pageId: string): Promise<string | null> {
  if (!conn.tokenEncrypted) return null;
  try {
    const userToken = decryptToken(conn.tokenEncrypted);
    const pages = await provider.listPages(userToken);
    return pages.find((p) => p.pageId === pageId)?.accessToken ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PAGES + FORMS
// ---------------------------------------------------------------------------

export async function syncPages(orgId: string, preFetched?: Awaited<ReturnType<MetaProvider["listPages"]>>) {
  const { accessToken, provider } = await requireActiveConnection(orgId);
  const pages = preFetched ?? (await provider.listPages(accessToken));
  for (const p of pages) {
    let subscriptionStatus = "SUBSCRIBED";
    let subscriptionError: string | null = null;
    try {
      const ok = await provider.subscribePage(p.accessToken, p.pageId);
      if (!ok) { subscriptionStatus = "ERROR"; subscriptionError = "subscribe call returned success=false"; }
    } catch (e) {
      subscriptionStatus = "ERROR";
      subscriptionError = e instanceof MetaError ? e.code : "SUBSCRIBE_FAILED";
    }
    await db.metaPageConnection.upsert({
      where: { organizationId_pageId: { organizationId: orgId, pageId: p.pageId } },
      create: {
        organizationId: orgId,
        connectionId: (await requireConnection(orgId)).id,
        pageId: p.pageId,
        pageName: p.pageName,
        subscriptionStatus,
        subscriptionError,
      },
      update: { pageName: p.pageName, subscriptionStatus, subscriptionError },
    }).catch((e) => {
      // v0.19.2 §18 invariant: one Meta page → one org. A P2002 on the
      // pageId unique means ANOTHER organization already connected this
      // page — surfaced as a typed, non-retryable error (never silent).
      if ((e as { code?: string })?.code === "P2002") {
        throw new MetaError(
          META_ERROR_CODE.META_PERMISSION_ERROR,
          "This Meta Page is already connected to another organization (one page → one organization invariant)"
        );
      }
      throw e;
    });
  }
  invalidateOrgCache(orgId);
  return pages.length;
}

/** Refresh forms for one page (or all pages when pageId omitted). */
export async function syncForms(orgId: string, pageId?: string) {
  const { accessToken, provider } = await requireActiveConnection(orgId);
  const pages = pageId
    ? [assertOrgScoped(await db.metaPageConnection.findUnique({ where: { organizationId_pageId: { organizationId: orgId, pageId } } }), orgId, "Page")]
    : await db.metaPageConnection.findMany({ where: { organizationId: orgId } });
  let discovered = 0;
  for (const page of pages) {
    const pageToken = provider.mode === "DEMO" ? accessToken : (await pageTokenFor(provider, { tokenEncrypted: (await requireConnection(orgId)).tokenEncrypted }, page.pageId)) ?? accessToken;
    const forms = await provider.listForms(pageToken, page.pageId);
    for (const f of forms) {
      const existing = await db.metaLeadForm.findUnique({ where: { organizationId_formId: { organizationId: orgId, formId: f.formId } } });
      if (!existing) {
        // NEW FORMS START INACTIVE — never auto-activate (spec 14).
        await db.metaLeadForm.create({
          data: {
            organizationId: orgId,
            pageConnectionId: page.id,
            formId: f.formId,
            formName: f.formName,
            status: f.status,
            active: false,
          },
        });
        discovered++;
      } else {
        await db.metaLeadForm.update({
          where: { id: existing.id },
          data: { formName: f.formName, status: f.status },
        });
      }
    }
  }
  return { discovered, pages: pages.length };
}

export async function repairSubscription(orgId: string, pageId: string) {
  const page = assertOrgScoped(
    await db.metaPageConnection.findUnique({ where: { organizationId_pageId: { organizationId: orgId, pageId } } }),
    orgId,
    "Page"
  );
  const { accessToken, provider } = await requireActiveConnection(orgId);
  const pageToken = provider.mode === "DEMO" ? accessToken : (await pageTokenFor(provider, { tokenEncrypted: (await requireConnection(orgId)).tokenEncrypted }, pageId)) ?? accessToken;
  try {
    const ok = await provider.subscribePage(pageToken, pageId);
    // Confirm the state through Meta where supported (real provider reads
    // subscribed_apps back; demo provider returns SUBSCRIBED).
    const confirmed = ok ? await provider.getSubscriptionStatus(pageToken, pageId) : "ERROR";
    await db.metaPageConnection.update({
      where: { id: page.id },
      data: {
        subscriptionStatus: confirmed,
        subscriptionError: confirmed === "ERROR" ? "resubscribe failed" : null,
      },
    });
    return { subscriptionStatus: confirmed };
  } catch (e) {
    const code = e instanceof MetaError ? e.code : "SUBSCRIBE_FAILED";
    await db.metaPageConnection.update({ where: { id: page.id }, data: { subscriptionStatus: "ERROR", subscriptionError: code } });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// MAPPING (tenant-validated)
// ---------------------------------------------------------------------------

export interface FormMappingInput {
  active?: boolean;
  leadSourceId?: string | null;
  defaultOwnerId?: string | null;
  defaultStageId?: string | null;
  mapping?: MappingRule[] | null;
}

export async function setFormMapping(orgId: string, formId: string, input: FormMappingInput) {
  const form = assertOrgScoped(
    await db.metaLeadForm.findUnique({ where: { organizationId_formId: { organizationId: orgId, formId } } }),
    orgId,
    "Form"
  );
  const data: Record<string, unknown> = {};
  if (input.active !== undefined) data.active = input.active;
  if (input.mapping !== undefined) data.mapping = input.mapping ?? undefined;

  if (input.leadSourceId !== undefined) {
    if (input.leadSourceId) {
      // Tenant check: LeadSource must belong to THIS org.
      const src = await db.leadSource.findFirst({ where: { id: input.leadSourceId, organizationId: orgId } });
      if (!src) throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "Lead source not found for this organization");
      data.leadSourceId = src.id;
    } else data.leadSourceId = null;
  }
  if (input.defaultOwnerId !== undefined) {
    if (input.defaultOwnerId) {
      // Tenant check: owner must be an ACTIVE member of THIS org.
      const member = await db.organizationMember.findFirst({
        where: { organizationId: orgId, userId: input.defaultOwnerId, status: "ACTIVE" },
      });
      if (!member) throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "Default owner is not an active member of this organization");
      data.defaultOwnerId = input.defaultOwnerId;
    } else data.defaultOwnerId = null;
  }
  if (input.defaultStageId !== undefined) {
    if (input.defaultStageId) {
      // Tenant check: stage must belong to a pipeline of THIS org.
      const stage = await db.pipelineStage.findFirst({
        where: { id: input.defaultStageId, pipeline: { organizationId: orgId } },
      });
      if (!stage) throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "Default stage not found for this organization");
      data.defaultStageId = input.defaultStageId;
    } else data.defaultStageId = null;
  }

  const updated = await db.metaLeadForm.update({ where: { id: form.id }, data: data as never });

  // Form activated → requeue its parked UNMAPPED_FORM events (spec 7:
  // "после mapping retry → exactly one Lead" — the unique leadgenId row
  // guarantees exactly-once ingestion).
  if (input.active === true) {
    await db.metaWebhookEvent.updateMany({
      where: { organizationId: orgId, formId, status: META_EVENT_STATUS.UNMAPPED_FORM },
      data: { status: META_EVENT_STATUS.PENDING, nextAttemptAt: new Date() },
    });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// WEBHOOK PERSISTENCE (routing pageId → org; leadgenId global uniqueness)
// ---------------------------------------------------------------------------

export interface PersistResult {
  received: number;
  persisted: number;
  duplicates: number;
  unmappedPages: number;
}

export async function persistLeadgenEvents(changes: LeadgenChange[], rawPayload: unknown): Promise<PersistResult> {
  const result: PersistResult = { received: changes.length, persisted: 0, duplicates: 0, unmappedPages: 0 };
  for (const change of changes) {
    // ROUTE (§19): pageId → org via the DETERMINISTIC routing service — never
    // findFirst, never a guess, never an org id from the payload.
    const route = await resolveMetaPageRoute(change.pageId);
    const orgId = route?.organizationId ?? null;
    if (!orgId) result.unmappedPages++;
    const status = orgId ? META_EVENT_STATUS.PENDING : META_EVENT_STATUS.UNMAPPED_PAGE;
    try {
      await db.metaWebhookEvent.create({
        data: {
          organizationId: orgId,
          pageId: change.pageId,
          formId: change.formId,
          leadgenId: change.leadgenId,
          payload: (rawPayload as never) ?? {},
          status,
        },
      });
      result.persisted++;
      if (route) {
        await db.metaPageConnection.update({ where: { id: route.pageConnectionId }, data: { lastWebhookAt: new Date() } });
      }
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") {
        // leadgenId unique violation — the SAME webhook delivered again.
        // One logical event, already durable. Ack as duplicate.
        result.duplicates++;
        continue;
      }
      throw e;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// STATUS + HEALTH (org-scoped — org A never sees org B)
// ---------------------------------------------------------------------------

const SAFE_CONN_SELECT = {
  id: true,
  status: true,
  appMode: true,
  displayName: true,
  tokenExpiresAt: true,
  connectedAt: true,
  lastLeadAt: true,
  authError: true,
} as const;

export async function getStatus(orgId: string) {
  const conn = await db.metaConnection.findUnique({ where: { organizationId: orgId }, select: SAFE_CONN_SELECT });
  const [pages, forms, failedEvents, lastLead] = await Promise.all([
    db.metaPageConnection.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } }),
    db.metaLeadForm.findMany({ where: { organizationId: orgId }, orderBy: { discoveredAt: "asc" } }),
    db.metaWebhookEvent.count({ where: { organizationId: orgId, status: { in: [META_EVENT_STATUS.FAILED, META_EVENT_STATUS.UNMAPPED_FORM, META_EVENT_STATUS.UNMAPPED_PAGE] } } }),
    db.metaWebhookEvent.findFirst({ where: { organizationId: orgId, status: META_EVENT_STATUS.COMPLETED }, orderBy: { processedAt: "desc" }, select: { processedAt: true, leadId: true } }),
  ]);
  const sources = await db.leadSource.findMany({ where: { organizationId: orgId, type: "meta_ads" } });
  return {
    connected: conn?.status === META_CONNECTION_STATUS.CONNECTED,
    connection: conn ? { ...conn, tokenExpiresAt: conn.tokenExpiresAt ?? null } : null,
    sources: sources.map((s) => ({ id: s.id, name: s.name, active: s.active })),
    pages: pages.map((p) => ({
      pageId: p.pageId,
      pageName: p.pageName,
      subscriptionStatus: p.subscriptionStatus,
      subscriptionError: p.subscriptionError,
      lastWebhookAt: p.lastWebhookAt,
      lastLeadAt: p.lastLeadAt,
    })),
    forms: forms.map((f) => ({
      formId: f.formId,
      formName: f.formName,
      status: f.status,
      active: f.active,
      leadSourceId: f.leadSourceId,
      defaultOwnerId: f.defaultOwnerId,
      defaultStageId: f.defaultStageId,
      mapping: f.mapping,
      lastLeadAt: f.lastLeadAt,
    })),
    health: {
      failedEvents,
      lastSuccessfulLeadAt: lastLead?.processedAt ?? null,
      tokenStatus: !conn ? "NONE" : conn.status === META_CONNECTION_STATUS.CONNECTED ? "OK" : conn.status,
      pagesSubscribed: pages.filter((p) => p.subscriptionStatus === "SUBSCRIBED").length,
      pagesTotal: pages.length,
      activeForms: forms.filter((f) => f.active).length,
      unmappedForms: forms.filter((f) => !f.active).length,
    },
  };
}

/** Failed events list for the UI — safe fields ONLY (code/time/status/id),
 *  never payloads (PII) or tokens. */
export async function getFailedEvents(orgId: string, limit = 50) {
  return db.metaWebhookEvent.findMany({
    where: { organizationId: orgId, status: { in: [META_EVENT_STATUS.FAILED, META_EVENT_STATUS.UNMAPPED_FORM, META_EVENT_STATUS.UNMAPPED_PAGE] } },
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      attempts: true,
      lastErrorCode: true,
      lastErrorAt: true,
      receivedAt: true,
      formId: true,
      pageId: true,
      leadId: true,
    },
  });
}

export async function retryEvent(orgId: string, eventId: string) {
  const ev = assertOrgScoped(await db.metaWebhookEvent.findUnique({ where: { id: eventId } }), orgId, "Event");
  await db.metaWebhookEvent.update({
    where: { id: ev.id },
    data: { status: META_EVENT_STATUS.PENDING, nextAttemptAt: new Date(), lastErrorCode: null, attempts: 0 },
  });
  return { ok: true };
}

export async function markConnectionStatus(orgId: string, status: string, authError?: string | null) {
  await db.metaConnection.updateMany({ where: { organizationId: orgId }, data: { status, authError: authError ?? null } });
}

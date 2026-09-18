/**
 * Meta Lead Ads Integration — Main Service
 * 
 * Orchestrates Meta connection, form mapping, and lead ingestion.
 * This is the primary interface for the Meta integration.
 */

import { db } from "@/lib/db";
import { decryptToken, encryptToken } from "./meta-encryption";
import {
  fetchLeadDetails,
  fetchPageDetails,
  fetchPageLeadForms,
  fetchUserPages,
  subscribePageToLeadgen,
  checkPageSubscription,
  unsubscribePageFromLeadgen,
  debugToken,
} from "./meta-client";
import { metaConfig, isMetaConfigured, validateMetaConfig } from "./meta-config";
import { MetaIntegrationError } from "./meta-errors";
import {
  normalizeMetaFieldData,
  applyFieldMapping,
  FieldMapping,
  formatPhoneNumber,
} from "./meta-lead-mapper";
import { getWebhookUrl } from "./meta-webhooks";
import { ingestLead } from "@/lib/leados/ingest-lead";

// Re-export types for convenience
export type { FieldMapping } from "./meta-lead-mapper";

/**
 * Connection status enum values.
 */
export type MetaConnectionStatus =
  | "ACTIVE"
  | "EXPIRING"
  | "EXPIRED"
  | "REAUTH_REQUIRED"
  | "ERROR";

export type MetaPageConnectionStatus = "ACTIVE" | "INACTIVE" | "ERROR";

export type MetaLeadFormStatus = "UNMAPPED" | "MAPPED" | "ACTIVE" | "INACTIVE";

/**
 * Connect Meta account with OAuth token.
 * Creates or updates MetaConnection for the organization.
 */
export async function connectMetaAccount(params: {
  organizationId: string;
  userId: string;
  accessToken: string;
  businessId?: string;
  metaUserId?: string;
}): Promise<{
  connectionId: string;
  status: MetaConnectionStatus;
  expiresAt?: Date;
  scopes?: string[];
}> {
  const { organizationId, userId, accessToken, businessId, metaUserId } = params;

  // Validate configuration
  validateMetaConfig();

  // Encrypt the access token
  const encryptedToken = await encryptToken(accessToken);

  // Debug token to get expiry and scopes
  const tokenInfo = await debugToken(accessToken);

  // Determine status based on token validity and expiry
  let status: MetaConnectionStatus = "ACTIVE";
  const expiresAt = tokenInfo.expiresAt
    ? new Date(tokenInfo.expiresAt * 1000)
    : undefined;

  if (!tokenInfo.isValid) {
    status = "REAUTH_REQUIRED";
  } else if (expiresAt && expiresAt.getTime() < Date.now()) {
    status = "EXPIRED";
  } else if (
    expiresAt &&
    expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
  ) {
    status = "EXPIRING"; // Less than 7 days
  }

  // Create or update connection
  const existing = await db.metaConnection.findFirst({
    where: { organizationId },
  });

  if (existing) {
    const updated = await db.metaConnection.update({
      where: { id: existing.id },
      data: {
        status,
        accessTokenEncrypted: encryptedToken,
        tokenExpiresAt: expiresAt,
        grantedScopes: tokenInfo.scopes || [],
        metaBusinessId: businessId || existing.metaBusinessId,
        metaUserId: metaUserId || existing.metaUserId,
        lastValidatedAt: new Date(),
        lastErrorCode: null,
      },
    });

    return {
      connectionId: updated.id,
      status: updated.status as MetaConnectionStatus,
      expiresAt: updated.tokenExpiresAt || undefined,
      scopes: (updated.grantedScopes as string[]) || [],
    };
  }

  const created = await db.metaConnection.create({
    data: {
      organizationId,
      status,
      metaBusinessId: businessId,
      metaUserId,
      accessTokenEncrypted: encryptedToken,
      tokenExpiresAt: expiresAt,
      grantedScopes: tokenInfo.scopes || [],
      createdByUserId: userId,
      lastValidatedAt: new Date(),
    },
  });

  return {
    connectionId: created.id,
    status: created.status as MetaConnectionStatus,
    expiresAt: created.tokenExpiresAt || undefined,
    scopes: (created.grantedScopes as string[]) || [],
  };
}

/**
 * Get decrypted access token for a Meta connection.
 */
export async function getMetaAccessToken(
  connectionId: string
): Promise<string> {
  const connection = await db.metaConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection) {
    throw new MetaIntegrationError(
      "Meta connection not found",
      "META_NOT_FOUND"
    );
  }

  if (
    connection.status === "EXPIRED" ||
    connection.status === "REAUTH_REQUIRED"
  ) {
    throw new MetaIntegrationError(
      "Token expired or invalid - reauthentication required",
      "META_TOKEN_EXPIRED"
    );
  }

  return decryptToken(connection.accessTokenEncrypted);
}

/**
 * Get available Pages for the connected Meta account.
 */
export async function getAvailablePages(
  connectionId: string
): Promise<
  Array<{
    id: string;
    name: string;
    accessToken: string;
    permissions: string[];
    alreadyConnected: boolean;
  }>
> {
  const connection = await db.metaConnection.findUnique({
    where: { id: connectionId },
    include: {
      pageConnections: {
        select: { pageId: true },
      },
    },
  });

  if (!connection) {
    throw new MetaIntegrationError(
      "Meta connection not found",
      "META_NOT_FOUND"
    );
  }

  const accessToken = await getMetaAccessToken(connectionId);
  const pages = await fetchUserPages(accessToken);

  const connectedPageIds = new Set(
    connection.pageConnections.map((pc) => pc.pageId)
  );

  return pages.map((page) => ({
    ...page,
    alreadyConnected: connectedPageIds.has(page.id),
  }));
}

/**
 * Connect a Page to the organization.
 */
export async function connectPage(params: {
  connectionId: string;
  pageId: string;
  pageName: string;
  pageAccessToken: string;
}): Promise<{ pageConnectionId: string; subscribed: boolean }> {
  const { connectionId, pageId, pageName, pageAccessToken } = params;

  const connection = await db.metaConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection) {
    throw new MetaIntegrationError(
      "Meta connection not found",
      "META_NOT_FOUND"
    );
  }

  // Encrypt page token if provided
  const encryptedPageToken = pageAccessToken
    ? await encryptToken(pageAccessToken)
    : null;

  // Check if already connected
  const existing = await db.metaPageConnection.findUnique({
    where: {
      metaConnectionId_pageId: {
        metaConnectionId: connectionId,
        pageId,
      },
    },
  });

  if (existing) {
    return { pageConnectionId: existing.id, subscribed: existing.subscribed };
  }

  // Subscribe to leadgen webhooks
  let subscribed = false;
  try {
    const webhookUrl = getWebhookUrl();
    const verifyToken = metaConfig.webhookVerifyToken || "";

    if (verifyToken) {
      await subscribePageToLeadgen(
        pageId,
        pageAccessToken || (await getMetaAccessToken(connectionId)),
        webhookUrl,
        verifyToken
      );

      // Verify subscription
      const subCheck = await checkPageSubscription(
        pageId,
        pageAccessToken || (await getMetaAccessToken(connectionId))
      );
      subscribed = subCheck.subscribed;
    }
  } catch (error) {
    console.error("[Meta] Failed to subscribe page to webhooks:", error);
    // Continue anyway - subscription can be repaired later
  }

  const pageConnection = await db.metaPageConnection.create({
    data: {
      organizationId: connection.organizationId,
      metaConnectionId: connectionId,
      pageId,
      pageName,
      pageTokenEncrypted: encryptedPageToken || undefined,
      status: "ACTIVE",
      subscribed,
    },
  });

  return { pageConnectionId: pageConnection.id, subscribed };
}

/**
 * Get lead forms for a connected Page.
 */
export async function getPageLeadForms(params: {
  pageConnectionId: string;
}): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    mapped: boolean;
    leadSourceId?: string;
  }>
> {
  const { pageConnectionId } = params;

  const pageConnection = await db.metaPageConnection.findUnique({
    where: { id: pageConnectionId },
    include: {
      metaConnection: true,
      leadForms: {
        select: {
          formId: true,
          leadSourceId: true,
          status: true,
        },
      },
    },
  });

  if (!pageConnection) {
    throw new MetaIntegrationError(
      "Page connection not found",
      "META_NOT_FOUND"
    );
  }

  const accessToken =
    pageConnection.pageTokenEncrypted
      ? await decryptToken(pageConnection.pageTokenEncrypted)
      : await getMetaAccessToken(pageConnection.metaConnectionId);

  const forms = await fetchPageLeadForms(
    pageConnection.pageId,
    accessToken
  );

  const mappedForms = new Map(
    pageConnection.leadForms.map((f) => [
      f.formId,
      { mapped: true, leadSourceId: f.leadSourceId ?? undefined, status: f.status },
    ] as [string, { mapped: boolean; leadSourceId?: string; status: string }])
  );

  return forms.map((form) => {
    const mapped = mappedForms.get(form.id);
    if (!mapped) {
      return {
        ...form,
        mapped: false,
      };
    }
    return {
      ...form,
      mapped: true,
      leadSourceId: (mapped as { leadSourceId?: string }).leadSourceId,
      metaStatus: (mapped as { status: string }).status,
    };
  });
}

/**
 * Create or update form mapping.
 */
export async function mapFormFields(params: {
  pageConnectionId: string;
  formId: string;
  formName: string;
  fieldMapping: FieldMapping[];
  defaultOwnerId?: string;
  defaultStageId?: string;
  leadSourceId?: string;
}): Promise<{ formId: string; status: MetaLeadFormStatus }> {
  const {
    pageConnectionId,
    formId,
    formName,
    fieldMapping,
    defaultOwnerId,
    defaultStageId,
    leadSourceId,
  } = params;

  const pageConnection = await db.metaPageConnection.findUnique({
    where: { id: pageConnectionId },
  });

  if (!pageConnection) {
    throw new MetaIntegrationError(
      "Page connection not found",
      "META_NOT_FOUND"
    );
  }

  // Upsert form mapping
  const form = await db.metaLeadForm.upsert({
    where: {
      metaPageConnectionId_formId: {
        metaPageConnectionId: pageConnectionId,
        formId,
      },
    },
    create: {
      organizationId: pageConnection.organizationId,
      metaPageConnectionId: pageConnectionId,
      formId,
      formName,
      status: "MAPPED",
      fieldMapping: fieldMapping as never,
      defaultOwnerId,
      defaultStageId,
      leadSourceId,
    },
    update: {
      formName,
      fieldMapping: fieldMapping as never,
      defaultOwnerId,
      defaultStageId,
      leadSourceId,
      status: "MAPPED",
      updatedAt: new Date(),
    },
  });

  return { formId: form.id, status: form.status as MetaLeadFormStatus };
}

/**
 * Fetch and process a single lead from Meta.
 * Returns the ingested lead ID or null if processing failed.
 */
export async function processMetaLead(
  eventOrLeadgenId: { eventId?: string; leadgenId: string }
): Promise<{
  success: boolean;
  leadId?: string;
  error?: string;
  duplicate?: boolean;
}> {
  const { eventId, leadgenId } = eventOrLeadgenId;

  try {
    // Find the webhook event
    let event = eventId
      ? await db.metaWebhookEvent.findUnique({
          where: { id: eventId },
        })
      : await db.metaWebhookEvent.findUnique({
          where: { leadgenId },
        });

    if (!event) {
      // Event doesn't exist - create it for tracking
      event = await db.metaWebhookEvent.create({
        data: {
          leadgenId,
          pageId: "unknown",
          formId: "unknown",
          createdTime: new Date(),
          payload: {},
          status: "RECEIVED",
        },
      });
    }

    // Check if already processed
    if (event.status === "INGESTED") {
      return {
        success: true,
        leadId: event.ingestedLeadId || undefined,
        duplicate: true,
      };
    }

    // Update status to FETCHING
    await db.metaWebhookEvent.update({
      where: { id: event.id },
      data: { status: "FETCHING", attemptCount: event.attemptCount + 1 },
    });

    // Find the page connection
    const pageConnection = await db.metaPageConnection.findFirst({
      where: { pageId: event.pageId },
      include: {
        metaConnection: true,
      },
    });

    if (!pageConnection) {
      await db.metaWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: "UNMAPPED_PAGE",
          errorCode: "UNMAPPED_PAGE",
          errorMessage: `Page ${event.pageId} is not connected`,
        },
      });
      return {
        success: false,
        error: `Page ${event.pageId} is not connected to any organization`,
      };
    }

    // Find the form mapping
    const formMapping = await db.metaLeadForm.findFirst({
      where: {
        metaPageConnectionId: pageConnection.id,
        formId: event.formId,
      },
    });

    if (!formMapping) {
      await db.metaWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: "UNMAPPED_FORM",
          errorCode: "UNMAPPED_FORM",
          errorMessage: `Form ${event.formId} is not mapped`,
        },
      });
      return {
        success: false,
        error: `Form ${event.formId} is not mapped to LeadOS fields`,
      };
    }

    // Get access token and fetch lead details
    const accessToken = await getMetaAccessToken(
      pageConnection.metaConnectionId
    );

    let leadDetails;
    try {
      leadDetails = await fetchLeadDetails(event.leadgenId, accessToken);
    } catch (error) {
      const metaError =
        error instanceof MetaIntegrationError
          ? error
          : new MetaIntegrationError(
              error instanceof Error ? error.message : "Unknown error",
              "META_TEMPORARY_ERROR",
              { cause: error }
            );

      if (!metaError.retryable) {
        await db.metaWebhookEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            errorCode: metaError.type,
            errorMessage: metaError.message,
          },
        });
        return { success: false, error: metaError.message };
      }

      throw metaError; // Let retry logic handle it
    }

    // Update event status to FETCHED
    await db.metaWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FETCHED",
        fetchedAt: new Date(),
      },
    });

    // Normalize and map field data
    const normalizedData = normalizeMetaFieldData(leadDetails.field_data);
    const mappings = (formMapping.fieldMapping as FieldMapping[]) || [];
    const mappedData = applyFieldMapping(normalizedData, mappings);

    // Format phone if present
    if (mappedData.phone) {
      mappedData.phone = formatPhoneNumber(mappedData.phone);
    }

    // Get LeadSource for this form
    let leadSourceId = formMapping.leadSourceId;
    
    // Create LeadSource if not exists
    if (!leadSourceId) {
      const existingSource = await db.leadSource.findFirst({
        where: {
          organizationId: pageConnection.organizationId,
          type: "meta",
          sourceIdentifier: `meta:${event.formId}`,
        },
      });

      if (existingSource) {
        leadSourceId = existingSource.id;
      } else {
        const newSource = await db.leadSource.create({
          data: {
            organizationId: pageConnection.organizationId,
            type: "meta",
            name: `${formMapping.formName} (Meta)`,
            sourceIdentifier: `meta:${event.formId}`,
            defaultOwnerId: formMapping.defaultOwnerId,
            defaultStageId: formMapping.defaultStageId,
          },
        });
        leadSourceId = newSource.id;

        // Update form mapping with leadSourceId
        await db.metaLeadForm.update({
          where: { id: formMapping.id },
          data: { leadSourceId },
        });
      }
    }

    // Call canonical ingestLead() - the ONLY way to create a Lead
    const ingestionResult = await ingestLead({
      organizationId: pageConnection.organizationId,
      sourceType: "meta",
      externalId: event.leadgenId, // Idempotency key
      sourceDetail: formMapping.formName,
      firstName: mappedData.firstName,
      lastName: mappedData.lastName,
      email: mappedData.email,
      phone: mappedData.phone,
      company: mappedData.company,
      position: mappedData.position,
      city: mappedData.city,
      country: mappedData.country,
      defaultOwnerId: formMapping.defaultOwnerId || undefined,
      defaultStageId: formMapping.defaultStageId || undefined,
      metaMetadata: {
        pageId: event.pageId,
        formId: event.formId,
        campaignId: leadDetails.campaign_id,
        adId: leadDetails.ad_id,
        adsetId: leadDetails.adset_id,
        metaCreatedAt: event.createdTime,
        webhookReceivedAt: event.receivedAt,
        leadFetchedAt: new Date(),
      },
      customFields: mappedData.customFields,
      tags: ["Meta Lead"],
      actorUserId: null, // System ingestion
    });

    // Update event status to INGESTED
    await db.metaWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: "INGESTED",
        ingestedAt: new Date(),
        ingestedLeadId: ingestionResult.lead.id,
      },
    });

    // Update page connection last lead timestamp
    await db.metaPageConnection.update({
      where: { id: pageConnection.id },
      data: { lastLeadAt: new Date() },
    });

    return {
      success: true,
      leadId: ingestionResult.lead.id,
      duplicate: ingestionResult.duplicate?.hasDuplicates === true,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (eventId) {
      await db.metaWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: "FAILED",
          errorCode: "PROCESSING_ERROR",
          errorMessage,
        },
      });
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Disconnect Meta integration.
 * Revokes local access and optionally unsubscribes pages.
 */
export async function disconnectMeta(params: {
  connectionId: string;
  unsubscribePages?: boolean;
}): Promise<{ success: boolean }> {
  const { connectionId, unsubscribePages = true } = params;

  const connection = await db.metaConnection.findUnique({
    where: { id: connectionId },
    include: { pageConnections: true },
  });

  if (!connection) {
    return { success: false };
  }

  // Unsubscribe pages if requested
  if (unsubscribePages) {
    for (const page of connection.pageConnections) {
      try {
        const pageToken = page.pageTokenEncrypted
          ? await decryptToken(page.pageTokenEncrypted)
          : await decryptToken(connection.accessTokenEncrypted);

        await unsubscribePageFromLeadgen(page.pageId, pageToken);
      } catch (error) {
        console.error(`[Meta] Failed to unsubscribe page ${page.pageId}:`, error);
      }
    }
  }

  // Delete tokens and mark as disconnected
  await db.metaConnection.update({
    where: { id: connectionId },
    data: {
      status: "REAUTH_REQUIRED",
      accessTokenEncrypted: "", // Clear token
      tokenExpiresAt: null,
      grantedScopes: [],
      lastErrorCode: "DISCONNECTED",
    },
  });

  return { success: true };
}

/**
 * Validate and refresh connection status.
 */
export async function validateConnection(
  connectionId: string
): Promise<{
  status: MetaConnectionStatus;
  expiresAt?: Date;
  scopes?: string[];
}> {
  const connection = await db.metaConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection) {
    throw new MetaIntegrationError(
      "Meta connection not found",
      "META_NOT_FOUND"
    );
  }

  const accessToken = await decryptToken(connection.accessTokenEncrypted);
  const tokenInfo = await debugToken(accessToken);

  let status: MetaConnectionStatus = "ACTIVE";
  const expiresAt = tokenInfo.expiresAt
    ? new Date(tokenInfo.expiresAt * 1000)
    : undefined;

  if (!tokenInfo.isValid) {
    status = "REAUTH_REQUIRED";
  } else if (expiresAt && expiresAt.getTime() < Date.now()) {
    status = "EXPIRED";
  } else if (
    expiresAt &&
    expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
  ) {
    status = "EXPIRING";
  }

  await db.metaConnection.update({
    where: { id: connectionId },
    data: {
      status,
      tokenExpiresAt: expiresAt,
      grantedScopes: tokenInfo.scopes || [],
      lastValidatedAt: new Date(),
      lastErrorCode: status === "ACTIVE" ? null : status,
    },
  });

  return {
    status,
    expiresAt,
    scopes: tokenInfo.scopes || [],
  };
}

/**
 * Meta Lead Ads Worker — Process pending webhook events
 * 
 * This worker runs periodically to fetch and ingest leads from Meta.
 * It processes events that are in RECEIVED or FETCHING status.
 */

import { db } from "@/lib/db";
import { processMetaLead } from "@/lib/integrations/meta/meta-service";
import { MetaIntegrationError } from "@/lib/integrations/meta/meta-errors";

const MAX_EVENTS_PER_RUN = 50;
const MAX_RETRY_ATTEMPTS = 5;

export async function processMetaWebhookEvents(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
}> {
  const stats = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
  };

  try {
    // Find events to process (RECEIVED or retryable FETCHING)
    const events = await db.metaWebhookEvent.findMany({
      where: {
        OR: [
          { status: "RECEIVED" },
          {
            status: "FETCHING",
            attemptCount: { lt: MAX_RETRY_ATTEMPTS },
          },
        ],
      },
      orderBy: { receivedAt: "asc" },
      take: MAX_EVENTS_PER_RUN,
    });

    for (const event of events) {
      stats.processed++;

      try {
        const result = await processMetaLead({
          eventId: event.id,
          leadgenId: event.leadgenId,
        });

        if (result.success) {
          stats.succeeded++;
          if (result.duplicate) {
            stats.retried++;
          }
        } else {
          stats.failed++;
        }
      } catch (error) {
        stats.failed++;

        // Check if we should retry
        const isRetryable =
          error instanceof MetaIntegrationError ? error.retryable : true;

        if (isRetryable && event.attemptCount < MAX_RETRY_ATTEMPTS) {
          // Will be retried on next run
          console.log(
            `[Meta Worker] Event ${event.id} will be retried (attempt ${event.attemptCount + 1})`
          );
        } else {
          // Mark as permanently failed
          await db.metaWebhookEvent.update({
            where: { id: event.id },
            data: {
              status: "FAILED",
              errorCode:
                error instanceof MetaIntegrationError
                  ? error.type
                  : "UNKNOWN_ERROR",
              errorMessage:
                error instanceof Error ? error.message : "Unknown error",
            },
          });
        }
      }
    }

    return stats;
  } catch (error) {
    console.error("[Meta Worker] Fatal error:", error);
    throw error;
  }
}

/**
 * Health check for Meta integration.
 * Checks for stuck events and connection issues.
 */
export async function checkMetaIntegrationHealth(): Promise<{
  healthy: boolean;
  issues: string[];
  stats: {
    receivedCount: number;
    fetchingCount: number;
    failedCount: number;
    unmappedPageCount: number;
    unmappedFormCount: number;
  };
}> {
  const issues: string[] = [];
  const stats = {
    receivedCount: 0,
    fetchingCount: 0,
    failedCount: 0,
    unmappedPageCount: 0,
    unmappedFormCount: 0,
  };

  try {
    // Count events by status
    const [received, fetching, failed, unmappedPage, unmappedForm] =
      await Promise.all([
        db.metaWebhookEvent.count({
          where: { status: "RECEIVED", receivedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
        }),
        db.metaWebhookEvent.count({
          where: { status: "FETCHING", receivedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
        }),
        db.metaWebhookEvent.count({
          where: { status: "FAILED", receivedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
        db.metaWebhookEvent.count({ where: { status: "UNMAPPED_PAGE" } }),
        db.metaWebhookEvent.count({ where: { status: "UNMAPPED_FORM" } }),
      ]);

    stats.receivedCount = received;
    stats.fetchingCount = fetching;
    stats.failedCount = failed;
    stats.unmappedPageCount = unmappedPage;
    stats.unmappedFormCount = unmappedForm;

    // Check for stuck events
    if (received > 10) {
      issues.push(`High backlog of received events: ${received}`);
    }

    if (fetching > 5) {
      issues.push(`Stuck fetching events: ${fetching}`);
    }

    if (failed > 20) {
      issues.push(`High failure rate: ${failed} failures in last 24h`);
    }

    if (unmappedPage > 0) {
      issues.push(`${unmappedPage} events from unmapped pages`);
    }

    if (unmappedForm > 0) {
      issues.push(`${unmappedForm} events from unmapped forms`);
    }

    // Check connections
    const expiredConnections = await db.metaConnection.count({
      where: {
        status: { in: ["EXPIRED", "REAUTH_REQUIRED", "ERROR"] },
      },
    });

    if (expiredConnections > 0) {
      issues.push(`${expiredConnections} Meta connections need attention`);
    }

    return {
      healthy: issues.length === 0,
      issues,
      stats,
    };
  } catch (error) {
    issues.push(`Health check failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    return {
      healthy: false,
      issues,
      stats,
    };
  }
}

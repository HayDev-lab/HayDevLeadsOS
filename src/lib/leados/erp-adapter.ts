// ERP/CRM integration — clean adapter interface + local mock implementation.
// This is NOT a production ERP connection. It records sync attempts so the
// pipeline is observable and ready to swap in a real provider later.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client";
import type { Lead, IntegrationSync } from "@prisma/client";

export interface ErpSyncResult {
  status: "SYNCED" | "FAILED" | "PENDING";
  externalRefId?: string;
  response?: Record<string, unknown>;
  error?: string;
}

export interface ErpAdapter {
  provider: string;
  /** Sync a lead to the external ERP/CRM. Returns the external ref + status. */
  syncLead(lead: Lead, orgId: string): Promise<ErpSyncResult>;
}

/**
 * Local mock adapter. Generates a deterministic external reference and marks
 * the record as SYNCED. Clearly a mock — no network calls, no fake claims.
 */
export class LocalErpAdapter implements ErpAdapter {
  provider = "HAYDEV_ERP";
  async syncLead(lead: Lead, _orgId: string): Promise<ErpSyncResult> {
    try {
      const externalRefId = `ERP-${lead.id.slice(-8).toUpperCase()}`;
      return {
        status: "SYNCED",
        externalRefId,
        response: {
          provider: "HAYDEV_ERP",
          mode: "local-mock",
          entity: "customer",
          pushedAt: new Date().toISOString(),
          contact: {
            name: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
            company: lead.company,
            phone: lead.phone,
            email: lead.email,
          },
        },
      };
    } catch (e) {
      return { status: "FAILED", error: e instanceof Error ? e.message : "unknown" };
    }
  }
}

let _adapter: ErpAdapter | null = null;
export function getErpAdapter(): ErpAdapter {
  if (!_adapter) _adapter = new LocalErpAdapter();
  return _adapter;
}

/**
 * Run an outbound sync for a lead: record an IntegrationSync row + a CRM_SYNC
 * lead event. Idempotent-ish: re-syncing updates the existing record if found.
 */
export async function syncLeadToErp(leadId: string, orgId: string, userId?: string | null): Promise<IntegrationSync> {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.organizationId !== orgId) {
    throw new Error("LEAD_NOT_FOUND");
  }
  const adapter = getErpAdapter();
  const result = await adapter.syncLead(lead, orgId);

  // Find existing pending/retry record for this lead+provider to update
  const existing = await db.integrationSync.findFirst({
    where: { leadId, provider: adapter.provider, entity: "lead" },
    orderBy: { createdAt: "desc" },
  });

  const data = {
    organizationId: orgId,
    leadId,
    provider: adapter.provider,
    externalRefId: result.externalRefId ?? existing?.externalRefId ?? null,
    entity: "lead",
    direction: "outbound",
    status: result.status,
    payload: { leadSnapshot: { id: lead.id, company: lead.company, email: lead.email, phone: lead.phone } } as Prisma.InputJsonValue,
    response: (result.response ?? null) as Prisma.InputJsonValue,
    error: result.error ?? null,
    attempts: (existing?.attempts ?? 0) + 1,
    lastSyncAt: result.status === "SYNCED" ? new Date() : existing?.lastSyncAt ?? null,
  } as const;

  let record: IntegrationSync;
  if (existing) {
    record = await db.integrationSync.update({ where: { id: existing.id }, data });
  } else {
    record = await db.integrationSync.create({ data });
  }

  await publishSyncEvent(orgId, leadId, userId, record.status, result.externalRefId);
  return record;
}

async function publishSyncEvent(orgId: string, leadId: string, userId?: string | null, status?: string, ref?: string) {
  const { publishEvent } = await import("./events");
  await publishEvent({
    orgId,
    leadId,
    userId,
    type: "CRM_SYNC",
    payload: { status, externalRefId: ref, at: new Date().toISOString() },
  });
}

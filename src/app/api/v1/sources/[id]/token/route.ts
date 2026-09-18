// HAYDEV LEADOS — SOURCE TOKEN MANAGEMENT (v0.19.2 §7).
//
// POST   → generate/rotate the source's public-ingest credential.
//          The full token is returned EXACTLY ONCE and never again.
// DELETE → disable the credential (ingestion fails closed until rotated).
//
// Session-authenticated + canMutate; the source is org-scoped (tenant guard).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, notFound, apiError } from "@/lib/leados/api";
import { requireOrgSource } from "@/lib/leados/tenant-guard";
import {
  generateSourceToken,
  storeSourceToken,
  disableSourceToken,
  sourceTokenMeta,
  SOURCE_TOKEN_PREFIX,
} from "@/lib/leados/source-token";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) {
      return NextResponse.json({ error: "Viewers cannot manage source credentials" }, { status: 403 });
    }
    const { id } = await params;
    const source = await requireOrgSource(session.orgId, id); // foreign id → 404
    const generated = generateSourceToken();
    await storeSourceToken(source.id, generated);
    return ok({
      // ONE-TIME reveal — store it now; it cannot be retrieved later.
      token: generated.token,
      tokenType: "bearer",
      usage: `Authorization: Bearer ${generated.token}`,
      meta: sourceTokenMeta({
        tokenPrefix: generated.prefix,
        tokenLast4: generated.last4,
        tokenCreatedAt: new Date(),
        tokenRevealedAt: new Date(),
        tokenDisabledAt: null,
      }),
    });
  } catch (e) {
    return apiError("source-token-rotate-failed", e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) {
      return NextResponse.json({ error: "Viewers cannot manage source credentials" }, { status: 403 });
    }
    const { id } = await params;
    const source = await requireOrgSource(session.orgId, id);
    if (!source.tokenPrefix) return notFound("source-token");
    await disableSourceToken(source.id);
    return ok({ disabled: true, meta: sourceTokenMeta(source) });
  } catch (e) {
    return apiError("source-token-disable-failed", e);
  }
}

export async function GET(_req: Request, { params }: Params) {
  // Status-only view (manager-safe): NEVER the secret, NEVER the hash.
  try {
    const session = await getSession();
    const { id } = await params;
    const source = await requireOrgSource(session.orgId, id);
    return ok({ meta: sourceTokenMeta(source), prefixScheme: SOURCE_TOKEN_PREFIX });
  } catch (e) {
    return apiError("source-token-status-failed", e);
  }
}

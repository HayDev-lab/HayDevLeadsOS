// PASSWORD RESET — request (v0.17 spec 23).
// Enumeration-safe: always the same response. The one-time token is hashed in
// the DB, valid for 1 hour. Delivery: via the configured email provider when
// one exists; otherwise the reset link is written to the SERVER CONSOLE ONLY
// (self-hosted recovery — documented in the report; a CLI fallback exists in
// scripts/set-password.ts).

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, tooMany, apiError, validate, parseJson } from "@/lib/leados/api";
import { generateToken, hashToken } from "@/lib/leados/auth/tokens";
import { actionLimiter, clientIp } from "@/lib/leados/auth/rate-limit";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { getEmailProvider } from "@/lib/leados/delivery/providers";

const REQUEST_SCHEMA = z.object({ email: z.string().email().max(200) });

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: Request) {
  const meta = requestMeta(req);
  const ip = clientIp(req);
  try {
    if (!actionLimiter.checkRateLimit(`reset:${ip}`)) {
      return tooMany("Too many requests. Try again later.");
    }
    const body = await parseJson(req);
    const v = validate(REQUEST_SCHEMA, body);
    if (!v.ok) return v.error;
    const email = v.value.email.trim().toLowerCase();

    const user = await db.user.findUnique({ where: { email } });
    if (user && user.passwordHash && user.status === "ACTIVE") {
      const token = generateToken(32);
      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const link = `${new URL(req.url).origin}/#/reset-password?token=${token}`;

      const provider = getEmailProvider();
      if (provider && provider.mode === "REAL") {
        await provider.send({
          to: user.email,
          subject: "LeadOS password reset",
          text: `Reset your LeadOS password (link valid 1 hour, one-time use):\n${link}\n\nIf you did not request this, ignore this email.`,
        });
      } else {
        // No real email provider configured — self-hosted recovery path.
        console.log(`[LEADOS][AUTH] password reset link for ${user.email}: ${link}`);
      }
      await recordAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorType: AUDIT_ACTOR.USER,
        action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
        resourceType: "user",
        resourceId: user.id,
        ...meta,
      });
    }
    // ENUMERATION-SAFE (spec 22): identical response either way.
    return ok({ ok: true, message: "If the account exists, reset instructions have been sent." });
  } catch (e) {
    return apiError("forgot-password-failed", e);
  }
}

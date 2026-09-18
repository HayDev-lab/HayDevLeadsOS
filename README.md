# HAYDEV LEADOS

## Meta Lead Ads Connector (v0.19)

Meta is an **adapter onto the existing LeadOS core** — there is no Meta-specific CRM logic:
`webhook → durable MetaWebhookEvent → worker → Graph fetch → mapper → canonical ingestLead() → Lead → LEAD_INGESTED → SLA → Automation → Notification`.

### Setup (real mode)
1. Create a Meta app (business type) at developers.facebook.com and add the **Lead Ads** product.
2. Complete **App Review** for: `leads_retrieval`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `ads_management`, plus Business Verification (lead access requires review).
3. Configure `.env` (see `.env.example`): `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_API_VERSION` (default `v26.0`, current stable — verified against Meta's changelog 2026-09-18), `META_WEBHOOK_VERIFY_TOKEN`, `META_REDIRECT_URI`, `INTEGRATION_ENCRYPTION_KEY` (**required in production**).
4. Webhook URL: `https://your-domain/api/v1/integrations/meta/webhook` (verify token = `META_WEBHOOK_VERIFY_TOKEN`; signature = `X-Hub-Signature-256`, HMAC-SHA256 of the raw body with the app secret).
5. In the app: Settings → Lead Sources → **[Connect Meta]** → approve permissions → the callback stores the encrypted token, subscribes your pages to the `leadgen` field, and discovers forms (new forms start **unmapped** — activate + map in the form dialog).
6. Test Lead: Meta's Lead Ads "create test lead" in the form preview UI, or use a real form. The webhook → lead chain is identical for test and real leads.

### Demo mode (`LEADOS_DEMO=true`)
`[Connect Demo Meta]` creates the HayDev Demo Meta Page with three forms (Website Development / AI Automation / ERP/CRM Leads). The demo provider makes **zero** calls to graph.facebook.com (guaranteed by construction). **Send test lead** runs the exact production contract: durable event → worker → mapper → `ingestLead()` → `LEAD_INGESTED`. The same `leadgenId` re-delivered 10× yields ONE lead (DB uniqueness).

### Security invariants
- One Meta webhook never produces duplicate logical effects (`leadgenId` globally unique + `LEAD_INGESTED` dedup key).
- Meta IDs from another tenant never cross org boundaries (all lookups org-scoped; routing derives the org from page connections, never from the payload).
- Access tokens are AES-256-GCM encrypted at rest and never returned by any API/UI/log.
- Unconfigured real OAuth returns an explicit 503 blocker listing the missing env vars (v0.19.1) — never fake success.
- The build is never green with TypeScript errors (`ignoreBuildErrors` removed; `bun run typecheck`).

### Commands
```bash
bun run typecheck   # tsc --noEmit — 0 errors required
bun test            # unit suites (encryption, webhook verify, mapper, errors, config, demo)
bun run lint        # eslint — 0 errors
```

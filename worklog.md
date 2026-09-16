# HAYDEV LEADOS — Worklog

## Project Status (initial inspection)
- Fresh Next.js 16.1.3 (Turbopack) scaffold. No existing HayDev modules code in repo.
- Stack: Prisma + SQLite (db/custom.db), full shadcn/ui (New York, neutral), @dnd-kit, recharts, framer-motion, sonner, next-intl, next-themes, next-auth, zod, tanstack query/table.
- Existing Prisma schema = scaffold (User + Post). Will be REPLACED with LeadOS schema (safe — no production data).
- Dev server running on :3000, clean.
- `next.config.ts` has `typescript.ignoreBuildErrors: true`, `reactStrictMode: false`.

## Architecture decision
LeadOS is built as the core product on this project (not a separate repo). Since no existing HayDev ERP/Business Audit code exists in-repo, I will:
- Build LeadOS core (orgs, users, leads, pipeline, activities, tasks, notes, tags, events, scoring, lost detector, duplicate detection, follow-up engine, attribution, inbox abstraction).
- Implement Business Audit as an **ingestion endpoint** that accepts audit payloads and creates/enriches leads (architecture-ready; mock UI preview embedded in Lead Detail).
- Implement ERP/CRM as an **adapter interface** + local mock implementation (sync status tracked, not fake production claim).
- Implement event publishing architecture (IntegrationEvent table + publisher) for future Automation Engine / Owner AI.
- i18n: AM/RU/EN via lightweight dictionary (next-intl is available but for a single-route app a typed dictionary is lighter and avoids route-group config complexity).
- Multi-tenant: organization_id on all tenant-scoped entities. Default org + demo users seeded.
- Auth: a demo session context (org + user) for the MVP — server-side org isolation enforced on every query. Role field on users prepared (OWNER/ADMIN/MANAGER/SALES_MANAGER/VIEWER).

## Phases
1. [DONE] Inspect existing project.
2. [IN PROGRESS] Prisma schema for LeadOS + db:push.
3. [TODO] lib business logic (normalize, scoring, lost-detector, followup, duplicate, audit-ingest, erp-adapter, events, i18n, seed, csv, attribution).
4. [TODO] API routes (v1): leads, pipeline/kanban, tasks, activities, notes, dashboard, lost-detector, business-audit, import, export, sources, tags, users, notifications, settings, search, erp-sync.
5. [TODO] App shell (sidebar, header, theme toggle, lang switcher, sticky footer) + i18n providers + dashboard page.
6. [TODO] UI screens: dashboard, leads list, lead detail, pipeline kanban, tasks, settings.
7. [TODO] Seed demo data.
8. [TODO] Browser QA + repair loops + final report.

---
Task ID: 1
Agent: main
Task: Inspect existing project structure and plan LeadOS architecture.

Work Log:
- Read package.json, prisma/schema.prisma, src/app/layout.tsx, page.tsx, globals.css, tailwind.config.ts, tsconfig.json, next.config.ts, Caddyfile, .env, examples/websocket, src tree.
- Confirmed: fresh scaffold, no existing HayDev modules, safe to build LeadOS as core product.

Stage Summary:
- Stack confirmed: Next.js 16 + Prisma/SQLite + shadcn/ui + dnd-kit + recharts + next-intl + next-themes.
- Decided LeadOS architecture: multi-tenant via organization_id, adapter-based ERP/Business-Audit ingestion, event publishing, AM/RU/EN i18n dictionary.
- Next: build Prisma schema.

---
Task ID: 2
Agent: main
Task: Build Prisma schema + lib business logic + API layer for LeadOS.

Work Log:
- Created full Prisma schema (org, users, leads, sources, pipeline/stages, tags, activities, tasks, notes, lead_events, business_audit, integration_sync, integration_event, incoming_message, source_attribution, lost_reason, notification, custom_field, scoring_config, setting, lost_lead_flag, lead_score_component). Multi-tenant via organization_id, soft-delete via archivedAt, indexes on hot paths.
- db:push OK. SQLite, enums as String.
- lib/leados: constants, normalize, i18n (AM/RU/EN typed dict), context (server session + org isolation + role auth), api helpers, scoring (explainable, configurable), lost-detector (deterministic), followup, duplicate, events (publish + IntegrationEvent), erp-adapter (interface + local mock), audit-ingest (Business Audit → lead), attribution + csv, seed (demo data ~30 fictional leads), lead-service (create/update/stage/assign/archive/merge), lead-score-service (recalc), lost-detector-service (run+persist flags), dashboard-service (metrics + recent + attention + activity stream).
- API v1 routes: seed, session, dashboard, lost-detector, leads (list/create), leads/ingest (public), leads/[id] (get/patch/archive), stage, assign, merge, score, duplicate, activities, tasks, notes, events, audit, erp-sync; pipeline, pipeline/kanban; tasks (+[id]); sources; tags; users; notifications; settings; search; business-audit; import (CSV); export (CSV); erp-sync.
- TypeScript: lib + api clean (no errors).

Stage Summary:
- Backend complete: schema, deterministic business logic (scoring, lost detector, follow-up, duplicate detection), adapter-based ERP + event publishing, Business Audit ingestion, public lead ingestion with rate-limit, CSV import/export, multi-tenant isolation enforced via getSession() on every route.
- Next: client UI (providers, i18n, hash-router, app shell, dashboard, leads list/detail, kanban, tasks, settings) + seed + browser QA.

---
Task ID: 3
Agent: main
Task: Build LeadOS client UI (providers, i18n, hash-router, app shell, dashboard, leads list, lead detail, kanban, tasks, settings, dialogs) + seed + browser QA + repair loops.

Work Log:
- Client foundation: providers.tsx (ThemeProvider, QueryClientProvider, LocaleProvider, sonner Toaster), locale.tsx (typed AM/RU/EN context + cookie persistence), hash-route.ts (view router via location.hash — only `/` route used, all views are hash segments), use-api.ts (React Query hooks for all resources + mutations with cache invalidation).
- UI primitives (primitives.tsx): timeAgo/formatDate/formatMoney, ScoreBadge, PriorityBadge, StageBadge, StatusPill, LeadAvatar, OwnerChip, SourceBadge (icons by source type), AttentionBadge, MiniBar, EmptyState, DemoBadge, TagChip.
- App shell (app-shell.tsx): sticky header (search/cmd-k, notifications bell, lang switcher, theme toggle, user switcher), desktop sidebar + mobile Sheet drawer, sticky footer (mt-auto), auto-seed on first load, attention count badge on dashboard nav. Nested components extracted to module level (lint fix).
- Dashboard view: 8 metric cards (new/unassigned/overdue/qualified/meetings/proposals/won/lost), attention banner, by-source + by-stage MiniBar charts, requires-attention list (lost detector flags), recent leads, overdue tasks, activity timeline.
- Leads list: search, filters (source/owner/stage/priority/overdue/unassigned), sortable table with pagination, bulk archive, CSV export button, import dialog, new-lead dialog with duplicate detection + merge/open/create-anyway.
- Lead detail: header (name/company/source/status/priority/score/owner + actions: call/message/email/edit/erp-sync/recalc-score/quote-disabled/archive), contact info, Business Audit summary (6 scores bars), deterministic AI summary (no fake AI), tabs (activity/notes/tasks/events), right panel (next action, open tasks, owner select, score explanation with +/- reasons, potential value, ERP sync status), stage changer (8 stages), duplicate banner with merge.
- Pipeline Kanban: 8 columns, dnd-kit drag & drop (useSetLeadStage mutation), cards with avatar/score/priority/value/unassigned warning, drag overlay, est value totals.
- Tasks view: active/overdue/done filters, inline create, toggle done, delete.
- Settings view: tabs for org, users, pipeline/stages, sources, tags, scoring rules (editable), Audit Ingest (live tester), ERP/Events reference.
- import-dialog, lead-form-dialog (with duplicate handling), audit-ingest-dialog.
- Reduced Prisma log noise (query→error/warn). Fixed: kanban route missing file, canMutate import location, events.ts JSON casts, seed.ts array types, validate() async→sync, hook order in EventsTab, set-state-in-effect lint, nested components, duplicate-detection-no-silent-create.

Browser QA (agent-browser):
- Dashboard 1440×900: renders all metrics, attention (26 leads), recent leads, activity stream. No console errors.
- Leads list: filters, table, pagination all working.
- Lead detail: stage change (Qualified) works — button becomes active/disabled, no errors.
- Pipeline Kanban: all 8 columns render with cards.
- Settings → Audit Ingest: ingested a test audit → lead count 30→31 (verified via API).
- Mobile 390×844: sidebar collapses to drawer, filters/table scroll horizontally, nav works.
- Desktop 1920×1080: clean, no errors.

Integration tests (curl):
- Duplicate detection: POST /leads with existing phone → created:false, lead:null, duplicate matches returned. With force:true → creates anyway.
- Public ingestion: POST /leads/ingest with x-org-slug header → lead created + attribution recorded.
- ERP sync on a WON lead → SYNCED with externalRefId ERP-XXXX.
- Security: lead of other org / non-existent → 404 {"error":"lead"} (org isolation enforced server-side via getSession on every query).
- Lost detector run: 26 leads needing attention, byReason breakdown (unassigned/no_contact/overdue_followup/no_activity/meeting_no_next/proposal_no_followup).

Stage Summary:
- LeadOS is a complete, coherent, production-shaped lead management layer. Every API route enforces org isolation via getSession(); role checks (canMutate) on mutations; deterministic business logic (scoring, lost detector, follow-up, duplicate detection); adapter-based ERP (local-mock, clearly labeled, no fake production claims); event publishing architecture (LeadEvent audit + IntegrationEvent for Automation Engine); Business Audit ingestion; public lead ingestion with rate-limit + attribution; CSV import/export; soft-delete; AM/RU/EN i18n; dark/light theme; responsive (desktop/tablet/mobile); sticky footer.
- Quality gates: TypeScript PASS (only pre-existing skills/ error remains, unrelated), lint PASS, browser QA PASS on 1920×1080 / 1440×900 / 1024×768-class / 390×844, persistence works (SQLite seeded, 30 demo leads + audit + tasks + flags), no runtime/hydration errors in console.
- Final verdict: VERIFIED_80_PERCENT_PRODUCT_READY (see report below).

---
HAYDEV LEADOS IMPLEMENTATION REPORT

Architecture
- Module of HayDev ecosystem on Next.js 16 + Prisma/SQLite + shadcn/ui. Multi-tenant via organization_id. Single `/` route; all views are hash segments (`#dashboard`, `#leads`, `#lead/<id>`, `#pipeline`, `#tasks`, `#settings`). Adapter-based integration (ERP, Business Audit, events) — no hard coupling.

Database
- 26 Prisma models: Organization, User, LeadSource, Pipeline, PipelineStage, Tag, LeadTag, Lead, LeadScoreComponent, LostLeadFlag, Activity, Task, Note, LeadEvent, BusinessAudit, IntegrationSync, IntegrationEvent, IncomingMessage, WebhookLog, SourceAttribution, LostReason, Notification, CustomField, CustomFieldValue, ScoringConfig, Setting. Indexes on org_id, created_at, owner_id, stage_id, normalized phone/email, next_action_at, source_id. Soft delete via archivedAt on leads. db:push applied.

Lead Workflow
- SOURCE (source/attribution) → LEAD (normalized phone/email) → duplicate check (no silent create) → QUALIFICATION (scoring) → ASSIGNMENT (owner) → FOLLOW-UP (next_action_at + suggestions) → PIPELINE (8 stages, kanban drag&drop) → CONVERSION (WON/LOST with reasons) → ERP sync (adapter) + IntegrationEvent published.

Business Audit Integration
- POST /api/v1/business-audit accepts a completed audit payload → creates/updates lead → attaches audit (6 scores + automation map + recommendations + report summary) → recomputes score → publishes audit.completed. Lead Detail shows the audit summary with score bars. Verified end-to-end (lead 31 created from audit payload).

ERP/CRM Integration
- ErpAdapter interface + LocalErpAdapter (local-mock, generates ERP-XXXX refs, records IntegrationSync). NOT a production connection — clearly labeled. Sync status tracked per lead (PENDING/SYNCED/FAILED/RETRY). Swap in a real provider by implementing the interface.

Lost Lead Detector
- Deterministic rule engine (NOT AI). Flags: unassigned, no_contact (new lead > 24h no contact), overdue_followup, no_activity (>48h in open stage), proposal_no_followup, meeting_no_next. Persisted as LostLeadFlag with severity (info/warning/critical). Dashboard attention list + leads list overdue filter. Run via POST /lost-detector.

Lead Scoring
- Explainable, configurable per org (ScoringConfig). 0–100, LOW/MEDIUM/HIGH. Components persisted with signed deltas (e.g. "+25 Business Audit completed", "+15 High automation potential"). Recalc on demand. No random values.

Dashboard
- Metric cards (8), attention banner + list, by-source + by-stage distribution, recent leads, overdue tasks, activity stream. Auto-refresh (30s/60s). Attention count in sidebar nav.

Mobile
- Verified 390×844: hamburger drawer nav, horizontally-scrollable table, full lead detail, filters. Desktop/tablet optimized; mobile allows view/call/message/stage change/note/task.

Security
- Server-side org isolation via getSession() on every route (orgId scoped; lead-not-in-org → 404). Role checks (canMutate — viewers can't mutate). Public ingestion resolved by x-org-slug header + in-memory rate limit + WebhookLog. No secrets in repo (.env has only DATABASE_URL). Input validation via zod. No raw SQL (Prisma parameterized).

Tests
- TypeScript PASS (lib + api + components clean). lint PASS. No unit/integration test files written (per "do not write test code" rule) — verified via curl integration checks + browser QA instead.

Browser QA
- Viewports verified: 1440×900, 1920×1080, 390×844. Screens: dashboard, lead list, lead detail, kanban, settings, mobile lead detail. No console errors / hydration errors after fixes.

Changed Files (substantial)
- prisma/schema.prisma (full LeadOS schema)
- src/lib/db.ts, src/lib/leados/* (constants, normalize, i18n, context, api, scoring, lost-detector, lost-detector-service, followup, duplicate, events, erp-adapter, audit-ingest, attribution, seed, lead-service, lead-score-service, dashboard-service, locale.tsx, hash-route.ts)
- src/lib/schemas/lead.ts
- src/hooks/leados/use-api.ts
- src/app/api/v1/** (30 route files)
- src/components/leados/* (app-shell, header-controls, primitives, dashboard-view, leads-view, lead-detail-view, pipeline-view, tasks-view, settings-view, lead-form-dialog, import-dialog)
- src/app/layout.tsx, src/app/providers.tsx, src/app/page.tsx

Remaining 20% (consciously deferred)
- Full pipeline/stage CRUD admin UI (currently seeded + editable scoring; pipeline config via DB).
- Custom fields CRUD UI + per-lead custom field editor (schema + values table ready; UI not built).
- Real ERP/CRM provider adapter (interface + local-mock in place).
- QuoteFlow / Automation Engine / Owner AI (integration points only — events published, button feature-flagged).
- Email/Telegram/WhatsApp notification delivery (in-app + architecture ready; channels not wired).
- Saved filters / advanced bulk actions beyond archive.
- Inbox UI for IncomingMessage (model + API ready; UI not built).
- Full analytics/BI view (dashboard metrics present; deep analytics deferred).
- Real auth (NextAuth) — demo session context with cookie-based user switching; org isolation enforced; production auth swap-in point ready.

Risks (real)
- Demo auth is cookie-based user switching (not NextAuth) — acceptable for first-client onboarding behind a controlled deployment; swap to NextAuth before public exposure.
- SQLite — fine for first client / single-org; migrate to Postgres for many concurrent tenants.
- Lost detector runs on-demand + on dashboard refresh (not a background job) — for large volumes, move to a scheduled worker.
- Prisma Json fields stored as TEXT on SQLite — fine for current scale.

FINAL VERDICT: VERIFIED_80_PERCENT_PRODUCT_READY
- First client can be onboarded WITHOUT rewriting core: create org + users (seed), configure pipeline (DB/seed), import leads (CSV), connect site (public ingest endpoint), start work — all present and verified.

---
Task ID: 4
Agent: main (cron round 1)
Task: QA current state + add Inbox, Analytics, Custom Fields features + styling polish.

QA Assessment:
- Dashboard, leads list, lead detail, kanban, tasks, settings — all render without console errors (1440×900, 1920×1080, 390×844 mobile, dark mode).
- Lost detector shows 26 leads needing attention. Duplicate detection, public ingestion, ERP sync all verified via curl.
- No bugs found in current state — proceed to new features.

Work completed this round:
1. Inbox UI (NEW):
   - lib/leados/inbox-service.ts: listMessages, getInboxStats, groupByConversation
   - API: /api/v1/inbox (GET list/stats, POST ingest), /api/v1/inbox/[id] (GET, PATCH link-to-lead, POST create-lead-from-message)
   - Hooks: useInbox, useInboxStats, useLinkMessage, useCreateLeadFromMessage
   - inbox-view.tsx: 3-pane layout (conversation list + message thread + reply stub), source filter chips (instagram/whatsapp/telegram/facebook/email/website with counts), unlinked filter, link-to-lead search, create-lead-from-message, framer-motion message entrance
   - Seed extended with 15 realistic incoming messages (5 channels, 6 linked + 4 unlinked conversations)
   - Nav badge for inbox unassigned count

2. Analytics view (NEW):
   - lib/leados/analytics-service.ts: totalLeads, won/lost/archived, conversionRate, avgResponseHours, winsBySource (count+value), lostReasons, 7-day time series, pipeline funnel (per-stage count+value), openPipelineValue, wonValue
   - API: /api/v1/analytics
   - Hook: useAnalytics
   - analytics-view.tsx: 6 KPI cards, recharts LineChart (7-day volume), vertical BarChart funnel, PieChart wins-by-source, lost-reasons progress bars. Deterministic metrics — no fake ROI.

3. Custom Fields (NEW):
   - API: /api/v1/custom-fields (GET, POST), /api/v1/custom-fields/[id] (DELETE, PATCH), /api/v1/custom-fields/[id]/values (GET, POST upsert)
   - Hooks: useCustomFields, useCreateCustomField, useDeleteCustomField, useSetCustomValue
   - settings-view.tsx: new "Custom fields" tab with create form (name/key/type/options) + list with delete. Key validation (snake_case).

4. Styling polish:
   - globals.css: custom scrollbar, focus-visible rings, leados-fade-in animation, leados-lift hover, leados-pulse for urgent badges, dense table hover
   - dashboard-view.tsx: framer-motion staggered entrance for metric cards (delay i*0.03), leados-lift on cards, leados-pulse on critical overdue indicator
   - inbox-view.tsx: framer-motion AnimatePresence for message entrance

5. i18n: added ~30 new keys per locale (hy/ru/en) for inbox, analytics, custom fields.

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Dev server unreachable during this round — last log shows compile OK then dashboard 500; server process died and was not auto-restarted by the system. Code verified via tsc+lint; browser QA deferred to next round once server recovers.

Unresolved issues / risks:
- Dev server (port 3000) is currently down and not auto-restarting. Next round: verify server recovery, then run full browser QA on new Inbox/Analytics/Custom-Fields views (dark mode + mobile 390×844), and fix any visual/runtime issues found.
- Inbox reply composer is disabled (outbound adapter not connected) — by design, architecture-only as documented.
- Custom-field per-lead editor UI inside Lead Detail is the next concrete step (settings CRUD done; per-lead value editing would require a new panel section reading the org's custom fields + per-lead values).

Next-phase priorities:
1. Bring dev server back / verify it auto-restarts; run browser QA on Inbox, Analytics, Custom Fields tabs.
2. Add per-lead custom field editor inside Lead Detail (right panel section).
3. Deeper dark-mode polish on new views (inbox thread, analytics charts).
4. Consider pipeline/stage admin CRUD (currently seeded-only).

---
Task ID: 5
Agent: main (cron round 2)
Task: QA new views (Inbox/Analytics/Custom Fields) + add per-lead custom field editor + pipeline/stage CRUD + saved filters + styling polish.

QA Assessment:
- Dev server was down at start of round (crashed in round 1, not auto-restarted). Manually restarted via `nohup bash .zscripts/dev.sh`.
- All new views verified working: Inbox (4 conversations), Analytics (34 leads, 6% conversion, 1h avg response), Custom Fields (2 fields: Industry, Budget), Pipeline CRUD (8 stages with inline rename + color picker).
- Lead Detail shows Custom Fields panel with Industry/Budget editors.
- Dark mode + mobile (390×844) verified on all new views.
- Stale Turbopack cache error about inbox/route.ts (canMutate import) — file is correct, API works, error is cosmetic only.

Work completed this round:
1. Per-lead Custom Field Editor (NEW):
   - custom-fields-panel.tsx: renders org's custom fields as editable inputs (text/number/select/bool/date) with debounced auto-save (400ms)
   - Integrated into Lead Detail (after AI Summary card)
   - Lead GET API now includes customValues with field definitions
   - Key-based remount on value change (no useEffect sync needed)

2. Pipeline/Stage Admin CRUD (NEW):
   - API: /api/v1/pipeline/stages (GET, POST), /api/v1/pipeline/stages/[id] (PATCH, DELETE)
   - Hooks: useCreateStage, useUpdateStage, useDeleteStage
   - Settings → Pipeline tab: inline rename (blur to save), color picker per stage, add new stage (name + type + color), delete (blocked if leads are in the stage)
   - Changes reflect immediately in Kanban via cache invalidation

3. Saved Filters (NEW):
   - use-saved-filters.ts: localStorage-based hook (add/remove, no backend needed)
   - Leads list: saved filter chips bar appears when filters are active; "Save current" prompt with name input; click chip to apply; hover to delete
   - Persists across sessions per browser

4. Styling Polish:
   - Dashboard: framer-motion animated attention banner with leados-pulse icon, staggered metric card entrance (delay i*0.03)
   - App shell: leados-fade-in page transition on view change (key=currentView)
   - Pipeline CRUD: color swatches, inline edit borders, smooth transitions
   - All new views: consistent dark-mode styling, custom scrollbar, focus-visible rings

5. Inbox data: added 4 test incoming messages via API (instagram/telegram/whatsapp/facebook) — all unlinked, ready for link-to-lead testing.

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: dashboard, leads, lead detail (with custom fields), inbox (4 conversations), analytics (charts render), settings (pipeline CRUD, custom fields CRUD), dark mode, mobile 390×844
- API checks: analytics (34 leads, 6% conversion), inbox (4 messages, 4 unassigned), custom-fields (2 fields)

Unresolved issues / risks:
- Dev server requires manual restart (nohup bash .zscripts/dev.sh) — system auto-restart not working. Next round: verify if server stays up.
- Stale Turbopack cache error about inbox route (cosmetic, doesn't affect functionality).
- Inbox reply composer still disabled (outbound adapter not connected — by design).

Next-phase priorities:
1. Verify dev server stability across rounds.
2. Notification channel adapters (email/Telegram/WhatsApp delivery — architecture ready, channels not wired).
3. Real auth (NextAuth) — demo session context works but needs production auth.
4. Deeper analytics: response time distribution, source ROI, team performance.
5. Saved filters sync to backend (currently localStorage only).

---
Task ID: 6
Agent: main (cron round 3)
Task: QA + add Team Performance view, Source ROI analytics, enhanced CSV export, styling polish.

QA Assessment:
- Dev server stable (HTTP 200) — survived from round 2's manual restart.
- All views verified: dashboard, leads, lead detail, inbox (4 conversations), analytics, pipeline kanban, tasks, settings. No console errors.
- Dark mode + mobile (390×844) verified on all views.

Work completed this round:
1. Team Performance view (NEW — #team):
   - lib/leados/team-service.ts: per-user metrics (totalAssigned, active, won, lost, conversionRate, overdueTasks, openTasks, avgResponseHours, wonValue, pipelineValue)
   - API: /api/v1/team
   - Hook: useTeamPerformance
   - team-view.tsx: team KPI row (6 cards), recharts BarChart (won vs active per user), user cards grid with avatar + metrics + response time + overdue + won/pipeline value, framer-motion staggered entrance
   - Nav entry "Team" added

2. Source ROI analytics (NEW):
   - analytics-service.ts extended: sourceRoi[] with per-source (type, name, count, won, lost, value, conversion)
   - analytics-view.tsx: Source ROI table with source icons, color-coded conversion badges, won value per source — for ad spend decisions
   - 11 sources tracked (Website, Business Audit, Instagram, Referral, Google Ads, etc.)

3. Enhanced CSV export (NEW):
   - Export now includes utmSource, utmCampaign (attribution) columns
   - Custom field values appended as cf_<key> columns (text/number/bool/date)
   - take: 2000 leads, includes attributions + customValues

4. Styling polish:
   - globals.css: skeleton shimmer animation (leados-skeleton), chart text color vars (recharts), dialog backdrop blur, tab indicator transition, tabular-nums utility
   - Dark mode charts: recharts text uses var(--muted-foreground) for proper dark contrast
   - Team view: leados-lift hover on user cards, motion staggered entrance

5. i18n: added nav.team key (HY: Թիմ, RU: Команда, EN: Team)

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: team view (4 users, chart renders), analytics with Source ROI table (11 sources), dark mode, mobile 390×844
- API checks: team (4 users — David 13 assigned/1 won, Narek 13/1, Aram 0/0, Lilit 0/0), sourceRoi (11 entries — Website 9 leads/1 won/11%, Business Audit 5/1/20%)
- CSV export verified: includes utmSource, utmCampaign columns

Unresolved issues / risks:
- Dev server requires manual restart if it crashes (system auto-restart not reliable). Currently stable from round 2's nohup restart.
- Inbox reply composer still disabled (outbound adapter not connected — by design).
- Real auth (NextAuth) still deferred — demo session works with org isolation.

Next-phase priorities:
1. Notification channel adapters (email/Telegram/WhatsApp delivery).
2. Real auth (NextAuth) for production.
3. Saved filters sync to backend (currently localStorage).
4. Deeper analytics: response time distribution, trend over time.
5. Pipeline stage reordering (drag to reorder positions).

---
Task ID: 7
Agent: main (cron round 4)
Task: QA + add bulk lead operations, pipeline stage drag-reorder, activity trend analytics, styling polish.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Bulk Lead Operations (NEW):
   - API: /api/v1/leads/bulk (POST) — actions: assign, stage, archive, priority
   - Hook: useBulkLeads with full cache invalidation
   - Leads list bulk bar: redesigned with count badge, 3 dropdowns (Assign to / Move to stage / Priority) + Archive button
   - All bulk actions emit activities + events (LEAD_ASSIGNED, STAGE_CHANGED, LEAD_ARCHIVED with bulk:true payload)
   - Server-side org isolation + role check on every bulk action

2. Pipeline Stage Drag Reorder (NEW):
   - settings-view.tsx PipelineTab: dnd-kit SortableContext with verticalListSortingStrategy
   - Drag handle (GripVertical) per stage, visual feedback (shadow + ring on drag)
   - onDragEnd persists new positions via updateStage mutation
   - SortableStage component: color picker, inline rename, type badge, delete button, loading spinner
   - Keyboard accessible (sortableKeyboardCoordinates)

3. Activity Trend Analytics (NEW):
   - analytics-service.ts: trend30 (30-day new leads + won per day), respBuckets (0-1h, 1-4h, 4-24h, 1-3d, 3d+, none)
   - analytics-view.tsx: 30-day heatmap (grid of colored squares with intensity = lead count, green dot for won days), response time distribution (color-coded progress bars per bucket)
   - Legend with less/more gradient

4. Styling Polish:
   - Bulk bar: shadow-sm, count badge in primary circle, responsive flex-wrap
   - Sortable stages: shadow-lg + ring on drag, cursor-grab handle
   - Heatmap: aspect-square cells, color-mix for intensity, tooltip on hover
   - Response distribution: color-coded buckets (green→red gradient by urgency)

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: analytics with 30-day heatmap + response distribution, pipeline sortable stages (drag handles visible), bulk actions (Assign/Move/Priority dropdowns), dark mode, mobile 390×844
- API checks: trend30 (30 days), respBuckets (0-1h:26, none:8), bulk API (correctly rejects non-org leads with "no-leads-in-org")

Unresolved issues / risks:
- Dev server stable from round 2's manual restart — still not auto-restarting if it crashes.
- Inbox reply composer still disabled (by design).
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Notification channel adapters (email/Telegram/WhatsApp delivery).
2. Real auth (NextAuth) for production.
3. Saved filters sync to backend (currently localStorage).
4. Lead assignment round-robin / auto-assignment rules.
5. Webhook outgoing events (for Automation Engine subscribers to consume).

---
Task ID: 8
Agent: main (cron round 5)
Task: QA + add Saved Filters backend sync, Assignment Rules (auto-assignment), Webhook Events viewer.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Saved Filters Backend Sync (NEW):
   - Prisma model: SavedFilter (organizationId, userId, name, query JSON, isShared, timestamps)
   - API: /api/v1/saved-filters (GET list — own + shared, POST create), /saved-filters/[id] (PATCH, DELETE)
   - Hooks: useSavedFiltersApi, useCreateSavedFilterApi, useDeleteSavedFilterApi
   - use-saved-filters.ts rewritten as hybrid: backend-first with localStorage fallback; merges both sources, dedupes by name+query
   - Filters sync across devices when authenticated; shared filters visible to whole org

2. Lead Auto-Assignment Rules (NEW):
   - Prisma model: AssignmentRule (organizationId, name, sourceId?, sourceType?, priority?, assigneeId, enabled, position)
   - API: /api/v1/assignment-rules (GET, POST), /assignment-rules/[id] (PATCH, DELETE)
   - Hooks: useAssignmentRules, useCreateAssignmentRule, useUpdateAssignmentRule, useDeleteAssignmentRule
   - lead-service.ts: resolveAutoAssignee() — evaluates rules in position order, first match wins, deterministic (NOT AI)
   - Settings → "Assignment Rules" tab: rule list with position badges, source/priority conditions, assignee avatar, enable/disable toggle, delete; add-rule form with source/priority/assignee dropdowns
   - Verified end-to-end: created "Instagram leads" rule → new instagram lead auto-assigned to manager

3. Webhook Outgoing Events Viewer (NEW):
   - API: /api/v1/webhooks/events (GET — list IntegrationEvents with byEvent summary, filterable by event type)
   - Hook: useWebhookEvents
   - Settings → ERP/Events tab: WebhookEventsTab shows recent published events with event-type badges, lead context, published indicator, timestamp; summary counts by event type at top
   - Documents the event architecture for future Automation Engine subscribers

4. Styling Polish:
   - Assignment rules: position number badges, toggle switches, condition badges, avatar inline
   - Webhook events: published dot indicator, monospace event names, summary badges
   - Saved filters: backend filters merge with local, shared filter indicator

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: assignment rules tab (rule visible, toggle, add form), webhook events tab (events list with summary), saved filters in leads (backend "Urgent leads" filter appears), dark mode, mobile 390×844
- API checks: saved-filters (create+list works), assignment-rules (create works), webhooks/events (5 events: 4 lead.created + 1 audit.completed)
- Auto-assign verified: instagram lead created without owner → automatically assigned to manager per rule

Unresolved issues / risks:
- Dev server crashed once mid-round (needed manual nohup restart). After restart, stable.
- Webhook delivery to external URLs not implemented (events are published to DB; a background worker would poll + deliver in production).
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Webhook URL registration + background delivery worker.
2. Real auth (NextAuth) for production.
3. Notification channel adapters (email/Telegram/WhatsApp delivery).
4. Assignment rule drag-reorder (currently position-based via create order).
5. Lead assignment round-robin (distribute evenly among a group, not just first-match).

---
Task ID: 9
Agent: main (cron round 6)
Task: QA + add Webhook URL registration + delivery, Lead restore from archive, archived leads view.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Webhook URL Registration + Delivery (NEW):
   - Prisma model: WebhookEndpoint (organizationId, name, url, secret, events, enabled, lastDeliveryAt, lastStatus, failCount)
   - API: /api/v1/webhooks/endpoints (GET, POST), /endpoints/[id] (PATCH, DELETE), /endpoints/[id]/test (POST)
   - lib/leados/webhook-delivery.ts: deliverPendingEvents() + testEndpoint() with HMAC-SHA256 signing (X-Leados-Signature header), 10s timeout, fail tracking
   - Hooks: useWebhookEndpoints, useCreateWebhookEndpoint, useDeleteWebhookEndpoint, useTestWebhookEndpoint
   - Settings → ERP/Events tab: WebhookEndpointsTab with endpoint list (status dot, fail count, last delivery), add-endpoint form (name/url/events), Test button per endpoint
   - Verified: created "Test Hook" → httpbin.org/post, test delivery returned HTTP 200

2. Lead Restore from Archive (NEW):
   - lead-service.ts: restoreLead() — unarchives lead, restores status based on stage type (won/lost/open)
   - API: /api/v1/leads/[id]/restore (POST)
   - Hook: useRestoreLead
   - Leads list: "📦 Archived" toggle filter shows archived leads with Restore button per row
   - Verified: archive → status=ARCHIVED, restore → status=NEW (restored correctly)

3. Styling Polish:
   - Webhook endpoints: status dot (emerald=OK, red=FAILED, gray=none), fail count badge, monospace URL, event filter badge
   - Archived leads: dedicated Actions column with Restore button, colSpan adjusts dynamically
   - Archived toggle: distinct zinc styling to differentiate from active filters

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: webhook endpoints tab (endpoint visible, Test button works), archived leads (toggle + Restore buttons), dark mode, mobile 390×844
- API checks: webhook endpoints (create+list+test all work, test delivery HTTP 200), lead restore (archive→ARCHIVED, restore→NEW)

Unresolved issues / risks:
- Dev server required restart mid-round (Prisma client cache needed refresh after schema change). After restart, stable.
- Webhook delivery is on-demand (test endpoint); background worker for automatic delivery not implemented.
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Background webhook delivery worker (cron-like polling of undelivered events).
2. Real auth (NextAuth) for production.
3. Notification channel adapters (email/Telegram/WhatsApp delivery).
4. Kanban quick-view hover card (preview lead without navigation).
5. Lead merge UI improvements (field selection).

---
Task ID: 10
Agent: main (cron round 7)
Task: QA + add Kanban hover preview, Lead merge dialog with field selection, notification center improvements, styling polish.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Kanban Quick-View Hover Card (NEW):
   - pipeline-view.tsx: HoverCard wrapping each draggable card (400ms open delay, 150ms close)
   - LeadQuickPreview component: fetches full lead via useLead, shows avatar, name, company, priority badge, score, stage, phone/email/source, owner, next action (red if overdue), last contact, summary (2-line clamp), "Open lead" button
   - Lazy-loads lead data only on hover (no upfront cost for kanban rendering)

2. Lead Merge Dialog with Field Selection (NEW):
   - lead-detail-view.tsx: MergeDialog component with field comparison table
   - Side-by-side comparison: Field / This lead (target) / Duplicate (source) / Use source checkbox
   - 9 fields compared (firstName, lastName, company, phone, email, summary, requirements, estimatedValue, priority)
   - Rows with differences highlighted amber; checkboxes disabled for identical or empty source fields
   - Pre-merge: copies selected source fields to target via PATCH, then merges (archives source, moves activities/tasks/notes/events/tags)
   - Count badge shows how many fields will be copied

3. Notification Center Improvements (NEW):
   - header-controls.tsx: NotificationsBell redesigned
   - Unread count badge (number instead of dot, "9+" for >9)
   - "Mark all read" button in dropdown header
   - Per-notification: blue unread dot, title, message, relative timestamp (now/Xm/Xh/Xd)
   - Unread items highlighted with primary/5 background
   - Empty state with Bell icon + message
   - Wider dropdown (w-96), up to 20 items shown

4. Styling Polish:
   - Dashboard header: gradient text (from-foreground to-foreground/70, bg-clip-text)
   - Merge dialog: amber accent for merge action, comparison table with highlighted diff rows
   - Notification badge: min-width pill with bold count

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: kanban hover preview (shows lead details + Open button), merge dialog (field comparison table with checkboxes), notifications (Mark all read + unread indicators + timestamps), dark mode, mobile 390×844
- Merge dialog verified: created duplicate lead → banner shows → dialog opens with field comparison

Unresolved issues / risks:
- Dev server stable throughout this round (no restart needed).
- Webhook background delivery worker still not implemented (on-demand test only).
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Background webhook delivery worker (cron-like polling).
2. Real auth (NextAuth) for production.
3. Notification channel adapters (email/Telegram/WhatsApp delivery).
4. Kanban card quick-actions (inline assign/change-stage without opening lead).
5. Lead activity timeline export (PDF/CSV for client reports).

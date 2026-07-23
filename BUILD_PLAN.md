# Ojaven Build Plan — full scope (v2)

**Scope correction (2026-07-23).** This version supersedes the original
18-module plan, which under-described the product. Ojaven is the **complete
all-in-one platform for marketing agencies** — full feature depth to replace
GoHighLevel, SEMrush, HubSpot, Asana, Calendly, QuickBooks, Mailchimp and the
rest of the agency stack, plus our own features. Not a wedge, not an ops-only
tool. This document adds the eight missing modules (N-A…N-H), a tracked
cross-cutting section, and the inter-module glue as explicit schedulable work.

**Method note.** Schema claims below were re-verified against the working tree
on 2026-07-23. Verbatim column definitions live in `packages/db/src/schema/*.ts`.

**Execution rule (proven across all of Phase A).** One module per pass:
design review (decisions with tradeoffs, schema quoted from the actual files)
→ sign-off → backend + Vitest integration tests → full suite green → checkpoint
→ UI pass → human click-through → UI commit. Never batch modules. Two standards
added during A9: full-stack tests must **prove middleware execution via
observable side-channel** (the pino mutation lines), not assertion-pass alone;
and full suites run on a **quiet machine** (concurrent builds starve the
real-network tests into timeout flakes).

---

## Current state — Phase A COMPLETE (2026-07-23)

167/167 integration tests. All nine zero-external modules built, tested, and
click-verified:

| Pass | Module | Highlights |
|---|---|---|
| — | 1. Auth + Team | 4 roles, opt-in multi-owner, transfer, evidence-based removal, ownership recovery, JIT provisioning, recycled-email reclaim |
| A1 | 2. Agency Settings | branding, subdomain (denylist + provision-safe picker), timezone, currency |
| A2 | 3b. Contacts | one-primary invariant (lock + partial unique index) |
| A3 | 3c. Tags + Custom Fields | polymorphic `assertEntityLive` dispatcher, per-fieldType dynamic validation |
| A4 | 10a. Tasks + Activity timeline | optional entity link (association ≠ identity), completedAt preserve-original |
| A5 | 5. Retainer + Time Tracking | **effective-dated retainers** (history never rewrites), over-service derived at read, tz-aware date guard |
| A6 | 12a. Proposals | line items, sanitized HTML, public `/p/[token]` capability-URL accept/decline |
| A7 | 13a. Invoicing | gapless per-agency numbering, **proposal→invoice snapshot conversion**, payments + refund-unpay, void guards, public `/i/[token]` |
| A8 | 11a. Content Approval | CAS state machine, **manager review tier**, frozen-version locks |
| A9 | Audit + Notifications | uniform audit middleware (unforgettable), semantic public-accept audits, notifications read UI |

**Cross-cutting built:** multi-tenancy (agencyId everywhere, `requireAgency`),
soft-delete pattern, advisory-lock+constraint pattern (4 uses), roleGuards
(structure owner/admin + review manager+ tiers), `assertEntityLive` (4 entity
types), per-IP rate limiting for anonymous callers, the public capability-token
surface pattern (stealth-safe: noindex + robots + og-override), onError→pino,
runtime probes (`pingTx`, `pingReclaim`), `reconcile-clerk-dev` drift script,
full-stack test harness (`createCallerFactory`).

---

## External service gates (updated for full scope)

| Service | Unlocks | Needed by |
|---|---|---|
| Upstash Redis | Rate limiting live (wired, env-vars only) | B1 |
| Cloudflare R2 | Uploads (signed URLs) | B2 → 11b attachments, 9 PDFs, N-A assets |
| Resend | All outbound email | B3 → 6a, recovery-warning gap, 12/13 sends, dunning |
| Trigger.dev | Scheduling/background jobs | B4 → 6b engine, 13b recurring, 10b recurring, 9 scheduled |
| Stripe | Real payments | B5 → 13c, 12b links; later N-H, N-E rebilling, Ojaven's own billing |
| Nango + Google OAuth apps | GA4/GSC/Ads data | C2, **N-F build-half ground truth** |
| Twilio | SMS/WhatsApp; **numbers + recordings (N-C); voice (N-D)** | C3, N-C, N-D |
| Google/Microsoft OAuth | Calendar sync | C4 |
| Anthropic key | AI assistant; N-D conversation layer | C5, N-D |
| Sentry / PostHog | Observability | any time (B6) |
| **Social platform OAuth apps** (Meta, LinkedIn, X, TikTok, GBP) | N-G publishing/inbox; approval lead times are WEEKS — apply early | N-G |
| **DataForSEO-class API** | N-F licensed half (volumes, backlinks, competitor estimates) | post-revenue, by design |
| **CDN + custom-domain automation** (CF for SaaS) | N-A funnel hosting, per-funnel domains | N-A |
| Clerk plan features | SSO/SAML, org-level 2FA enforcement | X-9, enterprise deals |

---

## Build order

**Phase B — one external each (unchanged):**

| # | Pass |
|---|---|
| B1 | Upstash → rate limiting live |
| B2 | R2 → upload service → 11b attachments |
| B3 | Resend → transactional foundation + recovery-warning email → 6a |
| B4 | Trigger.dev → 6b sequences + **automations engine** (the glue substrate) |
| B5 | Stripe → 13c payments, 12b payment links |
| B6 | Sentry + PostHog |
| **B7** | **SaaS-mode tenancy ADR (design only, NO code)** — see N-E. Must land **before C1**: the portal's auth + subdomain routing are the first surfaces that would bake in single-level tenancy. Retrofitting a tenancy level is far worse than designing for it. Output: an architecture decision record, reviewed like any design pass. |

**Phase C — integrators (as before, now tenancy-aware after B7):**

| # | Pass | Notes |
|---|---|---|
| C0 | shadcn/ui foundation | one-pass re-skin of all Phase-A scaffolding (accepted debt); board DnD revisit |
| C1 | 14. Client Portal | C1a auth+shell (tenancy-aware per B7), C1b surfaces (11 approvals, 13 invoices, 9 dashboards) |
| C2 | 9. Reporting + Dashboards | Nango + GA4/GSC — **also the ground-truth substrate N-F builds on** |
| C3 | 7 + 15. Twilio + Unified Inbox | conversation-grouping design needed |
| C4 | 8. Calendar + Booking | no schema — full design pass |
| C5 | 16. AI Assistant | role-scoped retrieval, injection posture |
| C6 | 17. Reputation | no schema; GBP OAuth; sending rails |
| C7 | 18. Analytics + Attribution | consumes everything |

**Phase D — expansion modules (the scope correction), ordered by dependency:**

| # | Pass | Gated by |
|---|---|---|
| D1 | N-F SEO build-half (crawler, rank tracking, on-page) | C2 (integrations substrate) |
| D1b | N-F licensed half (volumes/backlinks/competitor) | **revenue** (API costs are per-seat real money) |
| D2 | N-C Call Tracking | C3 (Twilio live) |
| D3 | N-G Social Media Management | C3 (inbox), platform OAuth apps (apply during C), 11 (approval, done) |
| D4 | N-B Forms + Surveys | B4 (engine); standalone script-embed v1 before N-A, full funnel embedding after |
| D5 | N-A Funnel + Website Builder | B2, C0, CDN/domains — **a product in itself; expect multiple design passes** (D5a builder core, D5b commerce, D5c hosting/domains, D5d analytics) |
| D6 | N-H Memberships / Courses | D5 (funnels), B5 (payments), C1 (portal) |
| D7 | N-D Voice / Conversation AI | C4 (calendar), C5 (AI), Twilio voice |
| D8 | N-E SaaS Mode BUILD | **revenue** + B5 + C1 + white-label theming; the ADR from B7 governs |

---

## New module sections (N-A … N-H)

**Schema status: NONE of the eight has a module schema.** Three have partial
substrates (noted below) — which changes the *shape* of their design pass, not
whether one is needed. Every one requires a full design review before any code.

### N-A. Funnel + Website Builder — D5 (GHL-class; their #1 feature)
Drag-and-drop page builder, templates, multi-step funnels, upsells/downsells,
order bumps, countdown timers, per-funnel hosting + custom domains + CDN,
funnel analytics/attribution. **Greenfield everywhere** — no schema, no
substrate. Heaviest single item in this plan; treat as a product with its own
multi-pass roadmap (D5a–D5d). Deps: R2, C0, CDN/domain automation, B5 for
commerce.

### N-B. Forms + Surveys — D4 (replaces Typeform/Jotform)
Builder with conditional logic; submissions land in CRM as contacts/
opportunities; embeddable; fires automation triggers (`form_submitted` already
exists in `automationTriggerTypeEnum` — a one-line substrate). Otherwise
greenfield. Deps: B4 engine; N-A for native funnel embedding (script-tag
embeds can ship first).

### N-C. Call Tracking — D2
Tracking numbers per campaign, call→source attribution, recording, timeline
logging (rides `activities` — substrate exists via `assertEntityLive`).
Numbers/recordings/webhooks are greenfield. Deps: Twilio (C3).

### N-D. Voice / Conversation AI — D7
Inbound answering, voice appointment booking, 24/7 SMS/chat response.
Greenfield + the most external-heavy module (Twilio voice, AI, calendar).
Deps: C4, C5, N-C infrastructure.

### N-E. SaaS Mode / Rebilling — B7 (ADR) + D8 (build)
Agencies resell white-labeled Ojaven to THEIR clients: sub-account
provisioning, billing controls/markup, "snapshots" (packaged account setups
deployed to new sub-accounts). **This is an ARCHITECTURAL review, not a module
review**: today one Clerk org = one agency and every query scopes by
`agencyId`. Sub-accounts are a SECOND TENANCY LEVEL beneath an agency —
touching module 1's identity model and, potentially, every agency-scoped query
in the codebase. That is why the ADR is scheduled at **B7**, years-of-regret
early, while the build waits for revenue: the *decision* must precede the
portal and everything after it; the *implementation* can wait. Deps for build:
B5, C1, white-label theming, snapshots design.

### N-F. SEO Intelligence — D1/D1b (SEMrush-class; hybrid build/license)
**The split maps exactly onto substrate-vs-greenfield:**
- **BUILD (D1):** GSC + GA4 connections = Google's **ground truth**, more
  accurate than SEMrush's estimates for a client's own site. **Substrate
  exists**: `integrations` (provider enum already has `google_search_console`,
  `google_analytics`, `google_ads`) + `reports` in `reporting.ts` — C2 builds
  the connection layer this half rides on. Site-audit crawler, rank tracking,
  on-page analysis: **greenfield** (crawler infra, SERP checks, new tables).
- **LICENSE (D1b):** keyword volumes, backlink index, competitor traffic —
  **cannot be crawled into existence** (needs a decade-old index). DataForSEO-
  class API, gated on revenue by design.

### N-G. Social Media Management — D3
Post scheduling + content calendar: **greenfield**. Social inbox: **substrate
exists** (`inbox.ts` conversations/messages with `instagram_dm` etc. — C3
builds the inbox this extends). Content Approval (A8, done) is the natural
upstream: approved content → scheduled post is a named glue flow. Deps:
platform OAuth apps (start applications during Phase C — approval lead times
are weeks), C3.

### N-H. Memberships / Courses — D6
Course builder, member areas, drip content. Greenfield. Deps: N-A (funnel/page
substrate), B5 (payments), C1 (portal identity for members).

---

## Cross-cutting work (tracked; none of these is a module)

| # | Item | Substrate today | Slot |
|---|---|---|---|
| X-1 | Global search (all entities) | none — design pass (Postgres FTS first, external engine later if needed) | after C0 |
| X-2 | Bulk actions (multi-select edit/delete/assign) | none | with C0 re-skin |
| X-3 | CSV import/export per module | none | rolling, start with clients/contacts |
| X-4 | Granular permissions (per-module, per-client) | roleGuards tiers exist; per-client is a new axis | design pass; before enterprise deals |
| X-5 | Public API for agency customers | tRPC exists; needs stable REST surface + API keys | post-C |
| X-6 | Mobile app (React Native) | the tRPC-first decision was made FOR this | after C0/C1 |
| X-7 | Onboarding/setup wizard | none | with C1 |
| X-8 | Notification preferences + digest emails | `notifications` live (A9); prefs schema needed | with B3/B4 |
| X-9 | SSO/SAML, 2FA | mostly Clerk plan features + enforcement UI | when enterprise asks |
| X-10 | Zapier/Make integration | **`webhooks` + `webhook_deliveries` + event enum exist, orphaned** | after B4 (`call_webhook` action shares the delivery engine) |

---

## Inter-module glue — the actual moat (explicit, schedulable)

All-in-one wins because data FLOWS. Built as silos, the modules are 18 worse
versions of existing tools. **Proven exemplar: proposal→invoice snapshot
conversion (A7).** Each flow below is a schedulable work item with a named
mechanism — not an assumed side effect.

Mechanisms: **[engine]** = automation via the B4 engine (trigger + action
rows already enumerated in `email.ts`); **[hook]** = direct service-level
call at the mutation site; **[notify]** = notifications write (A9 read UI is
live; writes are these items).

| Flow | Mechanism | Earliest |
|---|---|---|
| Proposal accepted → create deal + invoice draft | [hook] (conversion half done A7; deal-creation half remains) | now |
| Deal won → auto-create project + task set | [engine] (template tasks) or v1 [hook] | B4 / now |
| Time tracked → invoice line items + over-service alert | [hook] + [notify] | B4 |
| Invoice overdue → task + [notify] + dunning email | [engine] (needs B3+B4) | B4 |
| Client created → onboarding email sequence | [engine] (`client_created` trigger exists) | B4 |
| Form submission → contact + opportunity + trigger | [engine] (`form_submitted` trigger exists) | N-B |
| Booking made → task + calendar event + client record | [hook] in C4 | C4 |
| Content approved → schedule social publish | [hook] A8→N-G | D3 |
| Call tracked → timeline entry + attribution | [hook] N-C→activities | D2 |
| Project complete → review request | [engine] → 17 | C6 |
| Every action → activity feed + audit + notification | audit DONE (A9); timeline read-side merge + notification writes below | B4 |

**Audit semantic enrichment (glue-pass item, with a concrete example from live
data):** in the current audit trail, `proposal.accepted` is the ONLY row with
`entityType` set — because it's the one explicit semantic write standing
against the mechanical baseline (path + input snapshot). That gap, visible in
real data, is precisely what enrichment means: high-value mutations get
semantic `writeAudit` calls (entity typing, before/after diffs) as their glue
flows are built. Baseline legibility was reviewed and accepted 2026-07-23.

**Timeline read-side merge (A4/A9 resolution):** events are captured ONCE in
`audit_logs`; entity timelines later merge selected audit rows into the
activities view at read. No double-writes, no drift surface.

---

## Remaining original-module sections (unchanged content compressed)

- **6. Email Marketing (B3/B4):** schema exists (`email.ts`); campaign-entity
  gap decision at review; 6a templates/sends/webhook, 6b engine.
- **7+15. SMS/WhatsApp + Unified Inbox (C3):** `messages`/`conversations`
  exist; conversation-grouping design needed; email-in decision (Resend
  inbound vs IMAP).
- **8. Calendar + Booking (C4):** **no schema — full design pass** (largest
  net-new of Phase C); Google/Microsoft OAuth + sync engine.
- **9. Reporting (C2):** schema exists (`reporting.ts`); agency-level
  integrations not modeled (logged); order: widgets CRUD → Nango+GA4 →
  Recharts → scheduled PDFs.
- **14. Client Portal (C1):** `clientUsers` exists (same-Clerk-pool decision —
  already paying off: A8's `reviewedById` needs no change for portal
  reviewers); needs branding (done), contacts (done), magic-link invites (B3),
  subdomain routing, stealth-guard review; **now also governed by the B7
  tenancy ADR**.
- **16. AI Assistant (C5):** no schema; role-scoped retrieval is the hard
  design (an operator's assistant must not see past the role matrix);
  prompt-injection posture for CRM text.
- **17. Reputation (C6):** no schema; GBP OAuth; rides sending rails.
- **18. Analytics + Attribution (C7):** no schema; deliberately last.
- **Deferred sub-passes riding Phase B:** 10b recurring tasks + dependencies
  (B4), 11b attachments (B2), 12b payment links (B5), 13b recurring invoices
  (B4), 13c Stripe payments (B5).
- **Health score (module 3):** still deferred — inputs now exist (time,
  invoices, tasks, activity); becomes schedulable after B4. Logged.

---

## The launch gate (load-bearing — named, not committed)

The revenue gates above (D1b licensed data, D8 SaaS-mode build) mean the later
phases **assume revenue funds them**. That makes the launch gate the most
consequential dependency in this plan, so it gets defined rather than quietly
relied on.

**Minimum sellable configuration.** Phase A core (CRM, pipeline, tasks,
time/retainers, proposals, invoices, content approval — done) **plus**: B1–B5
(rate limiting live; attachments; email so clients *receive* proposals/
invoices, not just links; recurring invoices + the onboarding/dunning glue
flows; Stripe so agencies get paid through it), **C0** (scaffolding cannot be
charged for), **C1** (the portal — the client-facing half that makes billing
and approvals feel complete), and three cross-cutting items: X-7 onboarding
wizard, X-3 CSV import (agencies arrive with data), X-8 notification writes.
Explicitly NOT required to charge: C2 reporting (strengthens the pitch, not
the gate), everything D-phase.

**Roughly when.** That's ~9 remaining passes (B1–B5, C0, C1a/b, + the three
X items riding along) — at observed pace adjusted for externals' provisioning
and failure modes, the gate lands **around the middle of the 12–18 month
window**, leaving the back half of the core timeline for C2–C7 under early
revenue.

**What would have to be true to charge:**
1. **A real agency runs a week of real client work in it** without founder
   intervention — the design-partner bar, not a demo.
2. **The money path is closed-loop:** agency invoices client → client pays
   (Stripe) → Ojaven bills the agency (subscription). All three legs live.
3. **Stealth exit prerequisites:** production Clerk instance (dev keys never
   touch prod — standing rule), subdomain/custom-domain routing live, ToS/
   privacy, a support channel, and a tested backup/restore.
4. **Security re-check of the public surfaces** (capability tokens, portal
   auth) — including the A9 audit-failure revisit trigger if any early
   customer is compliance-bound.

Not a commitment — the gate named so the sequencing above doesn't depend on
something undefined. Re-review this section when B5 lands.

## Honest module count and what it does to the estimate

**Count.** Original plan: 18 modules ≈ 23 passes with sub-passes. Full scope
adds: 8 expansion modules (weighted: N-A ≈ 3 passes, N-E ≈ 2 + ADR, N-F ≈ 2,
N-D ≈ 1.5, others ≈ 1 each → **~12 pass-equivalents**), ~10 cross-cutting
items (**~4 pass-equivalents**), ~11 glue flows (**~2 pass-equivalents**,
mostly riding the B4 engine). **Total ≈ 41 pass-equivalents; 9 done.**

**The honest note.** Phase A's nine modules landed fast — but they were
hand-picked to be the easiest nine: zero externals, schema already existing,
no OAuth-app approval queues, no net-new product design. What remains carries
externals (each with provisioning + failure modes), platform-approval lead
times (social apps take weeks), five full net-new schema designs, one
architectural review (tenancy), and **two product-scale builds** (funnel
builder; SaaS mode) that are each bigger than any Phase-A module.

Straight math: **12–18 months holds for the sellable core** — the original 18
modules + the glue flows + priority cross-cutting (X-1 search, X-3 CSV, X-7
onboarding, X-8 notification writes). **The full directive scope (A–H at
GHL/SEMrush parity) is realistically 24–36 months solo part-time.** Two levers
are already built into the sequencing rather than hand-waved: revenue gates
(D1b licensed data and D8 SaaS-mode build are *deliberately* post-revenue), and
depth-vs-parity trims decided per design review, not assumed. Recommended
posture: drive to revenue on the core inside 12–18, then let paying agencies'
pull decide the D-phase order — with the B7 tenancy ADR done early so nothing
built in the meantime has to be torn up.

---

## KNOWN_ITEMS.md remains the ledger for accepted gaps (DnD desktop-only,
cross-pipeline moves, recovery email gap, session tail, db:push hazard,
retainer form ordering trap, log-on-behalf-of, no-org-switcher, etc.).

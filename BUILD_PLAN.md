# Ojaven Build Plan — remaining modules (2, 3-remainder, 5–18)

**Method note.** Every schema excerpt below was read from the working tree on
2026-07-19 — not recalled from the Week-1 summary (which was wrong once, about
deals soft-delete, since fixed). This read-through found **no further
mismatches** between prior claims and the files, but did surface real design
gaps, listed per module. Excerpts are verbatim column definitions with long
comments elided; full definitions live in `packages/db/src/schema/*.ts`.

**Execution rule (the session's proven pattern).** One module per pass:
design review → backend + Vitest integration tests → checkpoint → UI pass →
click-through. Never batch modules: the ws bug passed 27 unit tests and
would have broken every user — that bug class is only visible when each
layer is built small and exercised in the real runtime before the next
layer lands on top of it.

---

## Current state (done)

| Module | State |
|---|---|
| 1. Auth + Team Management | Backend + tests + UI. JIT provisioning, evidence-based removal, opt-in multi-owner, ownership recovery. |
| 3. Client Accounts | **Partial**: clients CRUD + UI only. Contacts, tags, custom fields, health score remain (→ 3b/3c below). |
| 4. Sales Pipeline | Backend + tests + board UI. |
| Cross-cutting infra | Clerk webhook sync, stealth guard, health probes (`ping`, `pingTx`), Pino + tRPC onError, 42/42 integration tests. |

## External service gates

Nothing below is provisioned yet except Clerk (dev instance), Neon, and the
Google Sheets waitlist. Each Phase-B item unblocks when its one service gets
an account/key — that's the ordering principle: **front-load everything that
needs zero new externals.**

| Service | Unlocks | Needed by |
|---|---|---|
| Upstash Redis | Rate limiting goes live (stub already wired, activates on env vars) | B1 |
| Cloudflare R2 | File uploads (signed URLs) | 11b attachments, 9 report PDFs |
| Resend | All outbound email | 6, recovery-warning gap (KNOWN_ITEMS), 12 send, 13 send |
| Trigger.dev | All scheduling/background jobs | 6b sequences/automations, 13b recurring invoices, 10b recurring tasks, 9 scheduled reports |
| Stripe | Real payments | 13c, 12b payment links, (later: Ojaven's own subscription billing) |
| Nango + provider OAuth apps | GA4/GSC/Ads/Meta/Shopify data | 9 |
| Twilio | SMS/WhatsApp | 7, 15 |
| Google/Microsoft OAuth apps | Calendar sync | 8 |
| Anthropic/OpenAI key | AI assistant | 16 |
| Sentry / PostHog | Observability (cross-cutting, slot anywhere) | any time |

## Build order

**Phase A — zero new externals, schema exists (or one small amendment):**

| # | Pass | Why this position |
|---|---|---|
| A1 | **2. Agency Settings** | Smallest pass; structure-role pattern already exists; branding is a prerequisite for the portal (C1). |
| A2 | **3b. Client Contacts** | Hard prerequisite for email sends (`email_sends.recipient_contact_id`), inbox (`messages.contact_id`), portal (`client_users.contact_id`). |
| A3 | **3c. Tags + Custom Fields** | Polymorphic infra several modules render against; better early than retrofitted. |
| A4 | **10a. Tasks** | Zero deps; `time_entries.task_id` references tasks, so before Time Tracking. Recurring/dependencies deferred to 10b (needs Trigger.dev + schema amendment). |
| A5 | **5. Time Tracking** | Needs A4. **Schema amendment required**: retainer-hours field doesn't exist (see module section). |
| A6 | **12a. Proposals (no Stripe)** | Clients + deals exist. Acceptance-UX decision required (see module section). |
| A7 | **13a. Invoices + manual payments (no Stripe)** | Clients + proposals exist. Invoice-numbering decision required. |
| A8 | **11a. Content Approval (internal, text-only)** | Attachments wait for R2; client-side approval waits for portal. |
| A9 | **Cross-cutting: audit-log writes + notifications read UI** | `audit_logs` exists but nothing writes it; `notifications` has no list/read procedure. Small, adopt into all prior modules' mutations. |

**Phase B — one external each (user provisions, then a small-to-medium pass):**

| # | Pass |
|---|---|
| B1 | Upstash → rate limiting live (near-zero code) |
| B2 | R2 → upload service + files procedures → 11b attachments |
| B3 | Resend → transactional foundation + recovery-warning email (closes a KNOWN_ITEMS gap) → 6a templates + one-off sends + status webhook |
| B4 | Trigger.dev → 6b sequences + automations engine; 13b recurring invoices; 10b recurring tasks |
| B5 | Stripe → 13c payment intents + webhooks; 12b payment links |
| B6 | Sentry + PostHog (any time, independent) |

**Phase C — integrators, multi-external, or net-new schema:**

| # | Pass | Notes |
|---|---|---|
| C0 | **UI foundation (shadcn/ui adoption)** | Before the portal: everything client-facing must stop looking like inline-styled scaffolding. Also the moment to revisit board DnD (KNOWN_ITEMS). |
| C1 | **14. Client Portal** | Needs 2, 3b, Clerk portal-user pool, subdomain routing. Split: C1a auth+shell, C1b surfaces (11 approvals, 13 invoices, 9 dashboards as available). |
| C2 | **9. Reporting + Dashboards** | Nango + GA4 first; widgets CRUD + metric fetch + Recharts; scheduled PDFs last (needs Trigger + R2). |
| C3 | **7 + 15. Twilio + Unified Inbox** | `messages` table exists; conversation-grouping design needed. |
| C4 | **8. Calendar + Booking** | **No schema exists** — full design pass first. |
| C5 | **16. AI Assistant** | Needs data-rich modules to be useful; no schema (conversation log design needed). |
| C6 | **17. Reputation** | **No schema exists**; Google Business OAuth; ties into email/SMS sending. |
| C7 | **18. Analytics + Attribution** | Last — consumes everything; touchpoint schema design needed. |

---

## Module sections

### 2. Agency Settings — Phase A1

**Depends on:** team roles (done). **Schema exists** (`identity.ts`, verbatim):

```ts
export const agencySettings = pgTable("agency_settings", {
  ...id,
  agencyId: uuid("agency_id").notNull().unique()
    .references(() => agencies.id, { onDelete: "cascade" }),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  subdomain: text("subdomain").notNull().unique(),
  customDomain: text("custom_domain").unique(),
  timezone: text("timezone").notNull().default("UTC"),
  currency: text("currency").notNull().default("USD"),
  ...timestamps,
});
```

Rows already JIT-provisioned with defaults. **Procedures:** `settings.get`
(agencyProcedure), `settings.update` (teamProcedure, owner/admin — this is
the canonical "structure" case). **Decisions:** subdomain change rules
(uniqueness collision UX, rename cooldown?); logoUrl is a bare URL until R2
(B2) makes it an upload. Custom-domain wiring is C1-portal scope, not here.

### 3b. Client Contacts — Phase A2

**Schema exists** (`crm.ts`, verbatim):

```ts
export const clientContacts = pgTable("client_contacts", {
  ...id,
  agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  isPrimary: boolean("is_primary").notNull().default(false),
  ...timestamps,
  ...softDelete,
}, /* lowercase-email check, client + agency indexes */);
```

**Procedures:** `contacts.listByClient`, `create`, `update`, `delete`
(agencyProcedure — data). **Decisions:** at-most-one `isPrimary` per client
(advisory-locked service guard, not a DB constraint — deliberately the
opposite call from the old one-owner index, worth confirming); join-filter
against soft-deleted clients same as deals.

### 3c. Tags + Custom Fields — Phase A3

**Schema exists** (`crm.ts`): `tags` (unique name per agency, color),
`entityTags` (polymorphic, unique (tagId, entityId)), `customFields`
(per-entity-type definitions, `fieldType` enum text/number/date/boolean/
select/url, `options` array for select), `customFieldValues` (unique
(fieldId, entityId), value stored as text). **Procedures:** tag CRUD +
attach/detach; field definitions CRUD (owner/admin — structure) + values
set/get (everyone — data). **Decisions:** value validation against
fieldType at the service layer; `entityTypeEnum` currently covers
client/client_contact/deal/task/proposal/invoice/content_item — extending
it later is an enum migration each time.

**Health score: explicitly deferred** — no meaningful inputs exist yet to
compute from. Log stays here so it isn't lost.

### 10a. Tasks — Phase A4

**Schema exists** (`activities.ts`, verbatim above in file; columns:
polymorphic optional entity link, title/description, status enum
todo/in_progress/done/cancelled, priority low→urgent, assignee/createdBy →
users, dueAt/completedAt, soft-delete). Also `activities` (unified
timeline) exists in the same file — folding `activities.listForEntity` +
`addNote` into this pass is cheap and gives every entity a timeline.

**Procedures:** `tasks.list({ mine?, entity?, status? })`, `create`,
`update`, `setStatus` (completedAt handling), `delete`;
`activities.listForEntity`, `activities.addNote`. All agencyProcedure
(data). **Gap:** recurring tasks + dependencies have **no schema** —
original Week-1 review deferred them deliberately; 10b (B4) adds
`recurrenceRule`/`parentTaskId` when Trigger.dev exists to execute them.

### 5. Retainer + Time Tracking — Phase A5

**Schema exists** (`time.ts`, verbatim above; hours numeric(6,2),
entryDate, isBillable, isOverService flag). **Two gaps found this
read-through:**
1. The file's own comment says over-service is computed against "a future
   retainer-hours field" — **that field does not exist**. Amendment needed:
   proposal is `clients.retainerHoursPerMonth numeric(6,2)` nullable
   (null = no retainer). Alternative (a `retainers` table with history)  is
   more correct for rate changes over time but heavier — decision at design
   review.
2. `time_entries` has **no soft-delete** — decide correction semantics
   (hard delete own entries? admin-only?) at review.

**Procedures:** `time.listByClient({ month })`, `logEntry`, `updateEntry`,
`deleteEntry`, `time.monthlyRollup({ clientId, month })` (hours vs retainer
→ over-service %), and the isOverService write-path on entry creation.

### 12a. Proposals — Phase A6 (Stripe-free)

**Schema exists** (`billing.ts`, verbatim above; status enum
draft/sent/viewed/accepted/declined/expired, `signedByName` simple e-sign,
`stripePaymentLinkId` dormant until B5). **No soft-delete on proposals** —
decide at review (probably add; unlike invoices they're not financial
records). **The real design question: acceptance UX without a portal.**
A client must open/accept before module 14 exists → a public
signed-token URL (`/p/[token]`, no auth) is the standard answer; needs a
`publicToken` column amendment + view/accept/decline public procedures with
the stealth guard considered (public route on a stealth app — path must be
unguessable, noindex). Full review before build.

### 13a. Invoicing — Phase A7 (Stripe-free)

**Schema exists** (`billing.ts`, verbatim above; invoices restrict-FK to
clients — billing records survive client soft-delete, already correct;
`isRecurring` is a text cadence label driving Trigger.dev later; payments
table with Stripe columns dormant). **Decisions:** per-agency
invoice-number sequences (advisory-locked counter — `invoiceNumber` is
text, no uniqueness constraint exists: add unique (agencyId,
invoiceNumber) amendment); manual status flow first
(draft→sent→paid/overdue/void) with `payments` rows recorded manually.

### 11a. Content Approval — Phase A8 (internal, text-only)

**Schema exists** (`content.ts`, verbatim above; status enum
draft/in_review/approved/rejected/published; `fileId` dormant until R2;
`reviewedById` → users — note it references *users*, which portal-side
client reviewers also are, so no amendment needed for C1). **Procedures:**
CRUD + `submitForReview` + `review({ approve|reject })` (internal roles
first; the client-facing half arrives with C1b).

### 6. Email Marketing — Phase B3/B4

**Schema exists** (`email.ts`, verbatim above): templates, sequences +
steps (unique (sequenceId, stepOrder) — reorder needs the same two-phase
trick as pipeline stages), sends (status enum queued→sent→delivered→
opened/clicked/bounced/failed, `resendMessageId` for webhook status),
automations + triggers + actions (jsonb configs, enums for
deal_stage_changed/task_completed/client_created/form_submitted/date_based
→ send_email/create_task/update_deal_stage/send_notification/call_webhook).
**Gap:** no "campaign" entity groups a one-off blast — sends are
individually addressed; decision at design review (add `email_campaigns` or
defer blasts). **Order:** 6a (B3, Resend): templates CRUD + single sends +
status webhook. 6b (B4, Trigger.dev): sequence enrollment/execution +
automations engine — the engine is a real design pass of its own (trigger
evaluation points inside existing services).

### 7. SMS + WhatsApp — Phase C3

No dedicated tables — rides `messages` (channel enum already has
sms/whatsapp/instagram_dm) + Twilio. Built together with 15.

### 8. Calendar + Booking — Phase C4

**No schema exists. None.** Full schema design pass required (calendars,
events, availability, booking links, external-event sync state) + Google/
Microsoft OAuth apps + sync engine. Largest net-new design of Phase C.

### 9. Reporting + Dashboards — Phase C2

**Schema exists** (`reporting.ts`, verbatim above): integrations
(per-client, unique (clientId, provider), `connectionRef` — token lives in
Nango, never our DB), dashboards (`isClientVisible` for portal), widgets
(chartType text + jsonb metricConfig), reports + reportGenerations
(scheduleCron → Trigger.dev, fileUrl → R2). **Gap:** agency-level (not
per-client) integrations aren't modeled — fine for v1, log it. **Order:**
widgets/dashboards CRUD → Nango + GA4 fetch layer → Recharts UI →
scheduled PDFs last.

### 14. Client Portal — Phase C1

**Schema exists** (`crm.ts`): `clientUsers` (userId → users = Clerk-backed
login, NOT an org member — the "same Clerk app, separate user pool"
decision from Week 1; contactId link; soft-delete). Touchpoints already in
place: `dashboards.isClientVisible`, `contentItems.reviewedById`,
invoices. **Needs:** 2 (branding), 3b (contacts), portal auth flow
(magic-link invite for client users — needs Resend, B3), subdomain
routing middleware, and a hard review of the stealth guard interaction
(portal is public-facing surface area on a stealth app). The biggest
integration pass in the plan; C1a shell/auth, C1b surfaces.

### 15. Unified Inbox — Phase C3

**Schema exists** (`inbox.ts`, verbatim above). **Gap:** no conversation/
thread grouping — `externalId` supports dedup but list-by-conversation
needs a design (thread key derivation or a conversations table).
Email-in is its own problem (inbound parsing — Resend inbound or IMAP —
decide at review). Twilio SMS/WA (7) lands here.

### 16. AI Assistant — Phase C5

**No schema** (conversation/audit log design needed). Needs an Anthropic
key and, to be useful, the data modules above it. Real design questions:
grounding scope per role (an operator's assistant must not summarize
what an operator can't see — the role matrix applies to retrieval),
prompt-injection posture for CRM-sourced text.

### 17. Reputation — Phase C6

**No schema.** Needs review-request + review tables, Google Business
OAuth, and sending rails (B3/C3). Design pass first.

### 18. Analytics + Attribution — Phase C7

**No schema** for touchpoints/attribution. Deliberately last: consumes
deals, invoices, integrations, inbox. Likely pairs with PostHog (B6).

---

## Cross-cutting items (not modules, must not be lost)

- **`audit_logs` is write-orphaned**: the table exists, nothing writes it.
  A9 adds the helper + adoption in every mutation service.
- **`notifications` is read-orphaned**: recovery writes them, nothing
  lists/reads them. A9 or first UI pass that wants a bell.
- **Outbound `webhooks`/`webhookDeliveries`**: schema exists, defer until a
  customer asks or an automation action (6b `call_webhook`) needs it.
- **shadcn/ui + design pass (C0)** before anything client-facing ships.
- **Rate-limit stub** activates with Upstash (B1) — no code needed.
- Everything in `KNOWN_ITEMS.md` (DnD desktop-only, cross-pipeline moves,
  recovery email gap, removal session tail).

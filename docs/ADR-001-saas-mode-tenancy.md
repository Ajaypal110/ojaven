# ADR-001 — SaaS-Mode Tenancy Shape

**Status:** ACCEPTED (review 2026-07-23; two amendments applied at acceptance)
**Date:** 2026-07-23
**Decides:** how sub-accounts (N-E, SaaS Mode / rebilling) relate to the
existing tenancy model — chosen NOW so nothing built between here and D8 bakes
in assumptions that would have to be torn up. Build remains at D8, post-revenue.

---

## 1. The problem

SaaS Mode (GHL's agency-scaling model) means an agency resells white-labeled
Ojaven to *their* clients. Each such client gets a **sub-account**: an isolated
workspace with its own users, CRM, pipelines, tasks — a full product instance
from that end-client's point of view, administered and billed by the agency.

Today's model has exactly one tenancy level: **one Clerk org = one `agencies`
row**, and every one of the 44 tables scopes by a single `agencyId` column,
enforced at a single point (`requireAgency` — the only multi-tenant gate in
the codebase, by design, since Neon has no RLS). A client today is a CRM *row*,
not a workspace. Sub-accounts add a second level. The question is what shape
that level takes.

## 2. Options

### Option 1 — a second scoping column (`subAccountId`)
Add sub-accounts as a child table and thread `subAccountId` (nullable) through
every tenant-scoped table and every query alongside `agencyId`.

**Rejected, permanently.** This is the retrofit nightmare quantified: 44
tables, every index, every service query, all 169 tests, and the single-
enforcement-point property of `requireAgency` destroyed (every query would
carry two-dimensional scoping logic). Nothing about the product requires it.
This ADR's primary purpose is to foreclose this path while it costs nothing.

### Option 2 — sub-account IS an agency (parent edge) ← **PROPOSED**
```
agencies.parentAgencyId uuid NULL REFERENCES agencies(id)   -- added at D8, not now
-- parentAgencyId IS NULL  → root agency (today's only case)
-- parentAgencyId NOT NULL → sub-account of that agency
```
A sub-account is a **first-class tenant**: its own `agencies` row, its own
`agency_settings` (subdomain, branding), its own members, its own everything.
The hierarchy lives in exactly ONE place — a parent edge between tenants —
and **data isolation remains single-column `agencyId` everywhere, unchanged**.

What today's "one workspace" model calls an agency becomes "a tenant";
"agency" and "sub-account" become *roles in a relationship*, not different
kinds of thing. This is the standard shape for this problem, and it is the
only option under which the 169 existing tests and every existing query stay
correct without modification.

### Option 3 — defer the decision entirely
Analyzed in §6; the cost is not in the schema (Option 2's column is one ALTER
whenever we want it) but in the **assumptions** intervening modules would bake
in without the invariants in §5.

## 3. What Option 2 does to each concern raised

### 3a. Identity model / Clerk orgs
- **Invariant preserved: one Clerk org per tenant workspace.** Each
  sub-account gets its own Clerk org at creation (programmatic, via the same
  org-provisioning path JIT/webhooks already use). `requireAgency` — resolve
  `ctx.agencyId` from `ctx.clerkOrgId` — is **untouched**: it neither knows
  nor cares whether the resolved row has a parent.
- **Agency staff reaching into sub-accounts** = membership, not magic:
  explicit `team_members` rows in the child agency (+ Clerk org membership for
  the org claim), granted/revoked by a service when SaaS mode is enabled.
  **Deliberately NOT implicit traversal** ("requireAgency lets parent-org
  members through") — implicit traversal would weaken the single enforcement
  point exactly where it must be strongest, be invisible to the audit trail,
  and be unrevocable per-child. Explicit rows are auditable
  (`team.member_joined` fires), revocable, and role-mappable per child.
- The end-client's *own* customers' portal users (`client_users`) nest
  cleanly: they are client_users **of the sub-account**, exactly as portal
  users are client_users of an agency today. No change.
- **Open item (verify before D8):** Clerk org-count limits/pricing at
  thousands of sub-account orgs. Fallback if Clerk-org-per-sub-account proves
  unviable: app-level child resolution (an "active sub-account" selector
  writing a claim), which contains the change to `requireAgency` alone — the
  data model is identical either way.

### 3b. `agencyId` scoping in every query
**Unchanged. This is the headline property and the reason for Option 2.**
A sub-account's rows carry the sub-account's own `agencyId`. Isolation between
sub-accounts of the same agency, between sub-accounts and unrelated agencies,
and between the agency's own workspace and its children is all the SAME
single-column isolation that exists today, enforced at the same single point.
Cross-account reads (an agency dashboard aggregating across its children) are
**additive** new read paths (`WHERE agencyId IN (SELECT id … WHERE
parentAgencyId = $root)`), built at D8 — they touch nothing existing.

### 3c. Everything else SaaS Mode needs (all additive, all D8)
- **Ojaven's own billing keys on the ROOT** (`parentAgencyId IS NULL`); child
  usage rolls up to the parent's bill; the agency's markup/rebilling to their
  clients is the agency's Stripe, not ours. *Recorded now* so B5's billing
  work never assumes "every agencies row is a billable customer."
- **White-labeling:** child `agency_settings` fall back to the parent's
  branding until overridden (a read-time coalesce, additive).
- **Snapshots** (package a configured account, deploy to new sub-accounts):
  a config serializer/applier over the config primitives — pipelines, tags,
  custom fields, templates, automations. These are already cleanly separable
  (hard-delete config tables, A3's deliberate design). No schema implications
  now.
- **Client-record → sub-account upgrade flow** (a CRM client "graduates" to a
  workspace): D8 design; likely a link column on `clients` + an explicit
  provisioning service. Nothing to decide now.

## 4. The decision (what B7 actually fixes in place)

1. **Sub-account = agencies row with a parent edge (Option 2).** Option 1 is
   foreclosed permanently.
2. **Tenant scoping stays single-column `agencyId` forever.** Any future
   feature that seems to need a second scoping column is mis-modeled — model
   it as a tenant edge or an authorization grant instead.
3. **Cross-tenant access is always explicit membership**, never implicit
   hierarchy traversal inside `requireAgency`.
4. **One Clerk org per tenant** stays the identity invariant (with the
   contained fallback noted in 3a if Clerk economics force it).
5. **Ojaven bills roots only.**
6. **No schema change now.** The `parentAgencyId` column lands at D8 with the
   feature; adding dormant DDL early buys nothing and violates the
   schema-at-module-build practice.

## 5. Guardrails binding code built between now and D8

These are the review-time invariants that make deferral of the *build* safe.
A violation of any of these is a design-review flag, not a style nit:

- **(G1)** Never assume `agencies` rows are all roots — no logic may treat
  "agency" and "top-level billable customer" as the same concept. (Bites: B5
  billing, admin/ops tooling, analytics.)
- **(G2)** Portal/subdomain routing (C1) resolves tenant → `agencies` row
  generically. A sub-account with its own subdomain must Just Work later
  without touching the router. (Bites: C1a.)
- **(G3)** Nothing new may join through `clerkOrgId` assuming org ↔ *root*
  agency; org ↔ *tenant* is the relation. (Bites: any future Clerk-side
  tooling, reconcile scripts.)
- **(G4)** Per-agency uniqueness (invoice numbering, tag names, subdomains)
  is per-TENANT uniqueness — correct as-is; do not "optimize" any of it to
  global or to parent-grouped scopes. Subdomains additionally: the A1
  reserved-word denylist applies to EVERY tenant's subdomain,
  tenant-agnostically — no sub-account provisioning path may bypass the same
  validation the agency path uses. A sub-account claiming a routing-critical
  subdomain is a new failure mode, not a hypothetical.
- **(G5)** X-4 granular permissions (whenever built) must model
  "role within a tenant" + "grants across tenants", not a bespoke two-level
  scheme that would become three-level pain at D8.
- **(G6)** The audit trail: cross-tenant administrative actions (an agency
  owner entering a child) must be attributable — the explicit-membership
  decision (3a) is what makes this free.

## 6. Migration cost: decide now vs defer

**Deciding now costs:** this document. Zero code, zero schema, zero risk.

**Deferring the decision** (deciding at D8 with no guardrails) risks each
intervening module baking in a root-only worldview — the concrete failure
modes are exactly the guardrails above inverted: billing that charges
sub-accounts as if they were customers (breaks the resell model at its core),
portal routing that assumes one brand per Clerk org (white-label retrofit
through the router), permissions built two-level (rebuilt at D8), ops tooling
that enumerates `agencies` as "customers." Each is an individually plausible
line of code in B5/C1/X-4 that this ADR makes reviewable *before* it exists.

**The catastrophic branch this ADR forecloses:** choosing Option 1 at D8 —
a second scoping column threaded through 44 tables, every query, every index,
and the entire test suite, plus the loss of single-point enforcement. That is
the "far worse" in "retrofitting a tenancy level is far worse than designing
for it," and after this ADR it can no longer happen by accident.

**What deferring the BUILD still costs (accepted):** none of the D8 features
exist until D8 — no sub-accounts, no rollup dashboards, no snapshots. That is
the plan working as intended; revenue gates the build, the ADR removes the
risk of the wait.

## 7. Revisit triggers

- Before D8 build: verify Clerk org limits/pricing at sub-account scale (3a
  fallback stands ready).
- If any pre-D8 module cannot satisfy its requirements inside G1–G6, this ADR
  reopens — by review, not by quiet exception.
- **Cross-tenant WRITES:** §3b analyzed additive cross-tenant READS (rollups),
  and snapshots are one-way provisioning-time writes. Any feature requiring an
  ONGOING cross-tenant write path — an agency mutating a child's live data as
  a normal operation — is a shape this document has not analyzed and reopens
  it before that feature's design review proceeds.

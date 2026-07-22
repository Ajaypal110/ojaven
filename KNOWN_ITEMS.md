# Known items

Deliberately deferred or accepted gaps, logged so they surface as decisions
later instead of surprises. Add the date and the reasoning when appending.

- **Pipeline board DnD is desktop-only** (2026-07-19). Native HTML5 drag
  events, mouse-only — no touch support. Mobile/tablet (and the future
  Expo app, which is the whole reason the API layer is tRPC) needs its own
  drag implementation, likely alongside the eventual shadcn/design pass.

- **Cross-pipeline deal moves unsupported** (2026-07-19). `deals.moveStage`
  refuses with an explicit BAD_REQUEST. Agencies do move deals between
  funnels — this comes back as a real feature, not a bug fix.

- **Ownership recovery has no out-of-app warning to owners** (2026-07-18).
  The in-app notifications are an audit trail only — an owner can only see
  them by signing in, which is the very act that invalidates the request.
  The 30-day inactivity precondition and 14-day grace period ARE the
  safeguard until Resend lands real email.

- **Subdomain denylist is belt-and-suspenders, not the routing fix** (2026-07-21).
  The reserved-word denylist blocks CUSTOMER claims on infra subdomains
  (accounts, clerk, api, ...). But the actual routing/auth/cert protection —
  ensuring `accounts.ojaven.com` reaches Clerk and not a customer even if
  the denylist were bypassed — is DNS wildcard-vs-specific-record
  precedence: a specific `accounts.ojaven.com` record beats the
  `*.ojaven.com` wildcard. That has to be set up at the portal / Clerk-prod
  stage (C1). Don't assume the denylist alone secures those names.

- **No in-app organization switcher** (2026-07-20). A user who already
  belongs to one org and is then invited to a SECOND org has no UI to make
  the new org their active Clerk org — so the (product) layout effect never
  fires `team.ensureMembership` for it and their team_members row for the
  second agency is never bootstrapped locally (webhook covers it in prod,
  but the local/gap path can't). Surfaced while diagnosing the
  recycled-email bug; distinct from it. Needs an org-switcher control
  (Clerk's `<OrganizationSwitcher>` or a custom one) — slot into the C0 UI
  foundation pass.

- **`drizzle-kit push` false-diff wants to truncate `entity_tags`** (2026-07-21).
  Every push since A3 re-proposes dropping+re-adding
  `entity_tags_tag_entity_unique` (a phantom diff on that one unique
  constraint). Harmless while the table is empty, but once it holds rows the
  drop/re-add triggers an interactive "truncate?" prompt that a non-TTY shell
  can't answer — and `--force` would auto-approve the truncate and DELETE the
  rows. So do NOT `--force` a push that touches `entity_tags`. Apply schema
  changes for other tables surgically via SQL (matching Drizzle's constraint
  names so no new diff appears), as done for the M5 `retainers`/`time_entries`
  amendment. Real fix: reconcile the `entity_tags` unique definition so the
  phantom diff stops (revisit at the C0 schema pass).

- **Retainer "from" picker lets you strand yourself in the future** (2026-07-22).
  The retainer form accepts a future effectiveFrom, and setRetainer refuses any
  later period that isn't strictly after the current open one — meanwhile time
  can only be logged in the past (future-date guard). So setting a retainer
  effective next month, then trying to log/test over-service THIS month, is a
  dead end: no reachable month has both a retainer and loggable time. Hit
  during the M5 click-through (had to clear the periods to recover). Fix
  candidates (UX only, invariants are correct): default the "from" picker to
  the current month, and/or warn when a future month is chosen, and/or allow
  re-opening an earlier period. Do at the M5 UI polish / C0 pass.

- **Log-time-on-behalf-of-others deferred** (2026-07-21). `time.logEntry`
  always writes `userId = ctx.userId` — you can only log your own time.
  Agencies will want a manager/admin to log time for a teammate (and to pick
  the user in the UI). Straightforward to add (an optional `userId` on
  logEntry, gated to owner/admin + validated as an active member, reusing the
  assignee-member guard shape). Slot in when the time-tracking UI gets its
  team view.

- **~60s session tail after member removal** (2026-07-19). A removed
  member's Clerk session token stays valid until the ~60s refresh cycle;
  org-claim-based procedures admit them for that window. Accepted: they had
  legitimate access moments earlier, so the tail discloses nothing new.
  Documented with reasoning in services/teamMembership.ts (removeMember).

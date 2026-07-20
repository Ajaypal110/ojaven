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

- **No in-app organization switcher** (2026-07-20). A user who already
  belongs to one org and is then invited to a SECOND org has no UI to make
  the new org their active Clerk org — so the (product) layout effect never
  fires `team.ensureMembership` for it and their team_members row for the
  second agency is never bootstrapped locally (webhook covers it in prod,
  but the local/gap path can't). Surfaced while diagnosing the
  recycled-email bug; distinct from it. Needs an org-switcher control
  (Clerk's `<OrganizationSwitcher>` or a custom one) — slot into the C0 UI
  foundation pass.

- **~60s session tail after member removal** (2026-07-19). A removed
  member's Clerk session token stays valid until the ~60s refresh cycle;
  org-claim-based procedures admit them for that window. Accepted: they had
  legitimate access moments earlier, so the tail discloses nothing new.
  Documented with reasoning in services/teamMembership.ts (removeMember).

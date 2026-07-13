import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { invitationStatusEnum, subscriptionStatusEnum, teamMemberRoleEnum } from "./_enums";

/**
 * A human. Clerk owns identity — this row is synced from Clerk webhooks
 * (user.created / user.updated / user.deleted), keyed by Clerk's own user
 * id (NOT a generated UUID — this is the one deliberate exception to the
 * "all IDs are UUIDs" rule, since it must match Clerk's id exactly to join
 * webhook events back to a row).
 *
 * A single user can be an agency team member (via team_members), a client
 * portal login (via client_users), or both — Clerk is the one identity
 * provider for every human in the system.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // Clerk user id, e.g. "user_2abc..."
    email: text("email").notNull().unique(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    imageUrl: text("image_url"),
    ...timestamps,
    ...softDelete, // retained (not hard-deleted) so historical references (activities, audit logs) stay intact
  },
  (table) => [
    check("users_email_lowercase", sql`${table.email} = lower(${table.email})`),
  ]
);

/**
 * A tenant. One row per Clerk Organization — this table is intentionally
 * minimal (identity + ownership only); branding/domain/timezone config
 * lives in agency_settings, and billing state lives in agency_subscriptions.
 */
export const agencies = pgTable("agencies", {
  ...id,
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps,
  ...softDelete,
});

/**
 * Extended per-agency configuration. 1:1 with agencies, split out so the
 * core agencies table stays lean and this can grow (more branding fields,
 * feature flags, etc.) without touching the identity table.
 */
export const agencySettings = pgTable("agency_settings", {
  ...id,
  agencyId: uuid("agency_id")
    .notNull()
    .unique()
    .references(() => agencies.id, { onDelete: "cascade" }),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"), // hex, for white-label client portal theming
  subdomain: text("subdomain").notNull().unique(), // <subdomain>.ojaven.com
  customDomain: text("custom_domain").unique(), // client portal on the agency's own domain
  timezone: text("timezone").notNull().default("UTC"),
  currency: text("currency").notNull().default("USD"), // ISO 4217
  ...timestamps,
});

/**
 * Stripe subscription state for the agency's own Ojaven bill (not to be
 * confused with agency-to-client billing, which lives in packages/db's
 * billing.ts — invoices/payments the agency sends to its clients).
 */
export const agencySubscriptions = pgTable("agency_subscriptions", {
  ...id,
  agencyId: uuid("agency_id")
    .notNull()
    .unique()
    .references(() => agencies.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripePriceId: text("stripe_price_id"),
  status: subscriptionStatusEnum("status").notNull().default("trialing"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  ...timestamps,
});

/**
 * Agency-side team membership. Clerk tracks basic org membership
 * (org:admin / org:member); the actual owner/admin/manager/operator
 * distinction — what tRPC middleware actually checks — lives here.
 */
export const teamMembers = pgTable(
  "team_members",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamMemberRoleEnum("role").notNull().default("operator"),
    clerkMembershipId: text("clerk_membership_id").unique(), // for idempotent webhook sync
    ...timestamps,
    ...softDelete, // removed-from-team, not hard-deleted (keeps audit trail / historical attribution)
  },
  (table) => [
    unique("team_members_agency_user_unique").on(table.agencyId, table.userId),
    index("team_members_agency_role_idx").on(table.agencyId, table.role),
    index("team_members_user_idx").on(table.userId),
  ]
);

/**
 * Pending team invites. Clerk sends the actual invitation email; this
 * table is our own record so we can show "pending invites" in the UI,
 * assign a role before the person accepts, and expire/revoke on our terms.
 */
export const invitations = pgTable(
  "invitations",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: teamMemberRoleEnum("role").notNull().default("operator"),
    status: invitationStatusEnum("status").notNull().default("pending"),
    invitedById: text("invited_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    clerkInvitationId: text("clerk_invitation_id").unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("invitations_email_lowercase", sql`${table.email} = lower(${table.email})`),
    index("invitations_agency_status_idx").on(table.agencyId, table.status),
    unique("invitations_agency_email_unique").on(table.agencyId, table.email),
  ]
);

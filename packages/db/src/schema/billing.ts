import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { invoiceStatusEnum, paymentStatusEnum, proposalStatusEnum } from "./_enums";
import { agencies, users } from "./identity";
import { clients } from "./crm";
import { deals } from "./pipeline";

export const proposals = pgTable(
  "proposals",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    bodyHtml: text("body_html").notNull(),
    value: numeric("value", { precision: 12, scale: 2 }).notNull().default("0"),
    status: proposalStatusEnum("status").notNull().default("draft"),
    // Unguessable capability token minted on send (not create) — the ONLY key
    // to the public /p/[token] view+accept surface. Unique; null while draft.
    publicToken: text("public_token").unique(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }), // first public view
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    signedByName: text("signed_by_name"), // e-signature capture, kept simple (name + timestamp) rather than a full signature-image pipeline for Day 1
    stripePaymentLinkId: text("stripe_payment_link_id"),
    ...timestamps,
    ...softDelete, // sales doc, not a financial record — soft-delete (accepted is protected in the service)
  },
  (table) => [
    index("proposals_agency_status_idx").on(table.agencyId, table.status),
    index("proposals_client_idx").on(table.clientId),
  ]
);

/**
 * Priced line items for a proposal. amount = quantity * unitPrice (computed at
 * write); proposals.value is the sum, recomputed in the same transaction on any
 * change. bodyHtml stays the narrative; these are the structured breakdown that
 * A7 invoices reuse (proposal -> invoice conversion).
 */
export const proposalLineItems = pgTable(
  "proposal_line_items",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("proposal_line_items_proposal_idx").on(table.proposalId)]
);

export const invoices = pgTable(
  "invoices",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }), // billing records survive even if the client is later soft-deleted
    proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
    invoiceNumber: text("invoice_number").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    tax: numeric("tax", { precision: 12, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    isRecurring: text("is_recurring"), // null = one-off; else a cadence label e.g. "monthly" (drives Trigger.dev scheduling)
    dueDate: timestamp("due_date", { withTimezone: true }),
    stripeInvoiceId: text("stripe_invoice_id").unique(),
    ...timestamps,
  },
  (table) => [
    index("invoices_agency_status_idx").on(table.agencyId, table.status),
    index("invoices_client_idx").on(table.clientId),
  ]
);

export const payments = pgTable(
  "payments",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    // Stripe Connect: which connected account the money actually settled to,
    // for agency-to-client billing where the agency is the merchant of record.
    stripeConnectedAccountId: text("stripe_connected_account_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("payments_invoice_idx").on(table.invoiceId)]
);

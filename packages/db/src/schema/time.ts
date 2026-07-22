import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { agencies, users } from "./identity";
import { clients } from "./crm";
import { tasks } from "./activities";

/**
 * A client's contracted retainer hours, effective-dated so history is exact.
 * Each calendar month maps to exactly one retainer: effectiveFrom is always a
 * 1st-of-month, effectiveTo is the last day the period applied (null = open/
 * current). Over-service reporting for a past month reads the retainer in
 * effect THAT month, so renegotiating a client's hours never rewrites history
 * — the whole reason this is a table, not a clients.retainerHoursPerMonth
 * column. (Billing-rate history will live here too, later.)
 */
export const retainers = pgTable(
  "retainers",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    hoursPerMonth: numeric("hours_per_month", { precision: 6, scale: 2 }).notNull(),
    effectiveFrom: date("effective_from").notNull(), // always a 1st-of-month
    effectiveTo: date("effective_to"), // null = current/open period
    ...timestamps,
  },
  (table) => [
    index("retainers_client_idx").on(table.clientId),
    index("retainers_client_effective_idx").on(table.clientId, table.effectiveFrom),
    // At most one OPEN period per client — the DB backstop behind the
    // advisory-locked close-then-open (same lock+constraint pattern as
    // client_contacts' one-primary).
    uniqueIndex("retainers_one_open_per_client")
      .on(table.clientId)
      .where(sql`${table.effectiveTo} IS NULL`),
  ]
);

/**
 * Hours logged against a client, for retainer / over-service tracking.
 *
 * Over-service is DERIVED at read time (monthlyRollup aggregates billable
 * hours vs the retainer in effect that month; listByClient marks entries past
 * the running cumulative). There is deliberately NO stored isOverService
 * flag — a per-entry boolean for a cumulative, order-and-retainer-dependent
 * quantity would silently drift on any edit, delete, or retainer change. If
 * list-render perf ever demands it, re-add it as a materialized column
 * recomputed per (client, month) on write — never as a write-at-create flag.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    description: text("description"),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    entryDate: date("entry_date").notNull(),
    isBillable: boolean("is_billable").notNull().default(true),
    ...timestamps,
    ...softDelete, // billing-adjacent: soft delete preserves the audit trail
  },
  (table) => [
    index("time_entries_agency_client_idx").on(table.agencyId, table.clientId),
    index("time_entries_user_date_idx").on(table.userId, table.entryDate),
    index("time_entries_client_date_idx").on(table.clientId, table.entryDate),
  ]
);

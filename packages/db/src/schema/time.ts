import { boolean, date, index, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { agencies, users } from "./identity";
import { clients } from "./crm";
import { tasks } from "./activities";

/**
 * Hours logged against a client, for retainer tracking. Over-service
 * detection (hours logged vs. the client's contracted retainer hours)
 * is computed at query time from clients.mrr / a future retainer-hours
 * field rather than stored here — `isOverService` is a denormalized flag
 * set by the app when the entry pushes the client over budget for the period.
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
    isOverService: boolean("is_over_service").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("time_entries_agency_client_idx").on(table.agencyId, table.clientId),
    index("time_entries_user_date_idx").on(table.userId, table.entryDate),
    index("time_entries_client_date_idx").on(table.clientId, table.entryDate),
  ]
);

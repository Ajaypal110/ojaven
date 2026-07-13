import { timestamp, uuid } from "drizzle-orm/pg-core";

/** Every table (except `users`, which is keyed by Clerk's user id) gets a UUID PK. */
export const id = {
  id: uuid("id").defaultRandom().primaryKey(),
};

/** Every table gets createdAt/updatedAt as timestamptz. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Spread into tables that support soft-delete (clients, deals, contacts, etc.). */
export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

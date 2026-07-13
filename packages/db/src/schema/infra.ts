import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import {
  entityTypeEnum,
  notificationTypeEnum,
  webhookDeliveryStatusEnum,
  webhookEventTypeEnum,
} from "./_enums";
import { agencies, users } from "./identity";

/** An in-app notification for a specific user. */
export const notifications = pgTable(
  "notifications",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    entityType: entityTypeEnum("entity_type"),
    entityId: uuid("entity_id"),
    title: text("title").notNull(),
    body: text("body"),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("notifications_user_read_idx").on(table.userId, table.readAt),
    index("notifications_agency_created_idx").on(table.agencyId, table.createdAt),
  ]
);

/** Immutable record of who changed what — never updated or soft-deleted after insert. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // e.g. "deal.stage_changed", "client.deleted"
    entityType: entityTypeEnum("entity_type"),
    entityId: uuid("entity_id"),
    changes: jsonb("changes"), // { before: {...}, after: {...} }
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("audit_logs_agency_created_idx").on(table.agencyId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ]
);

/** An agency-configured outbound webhook subscription. */
export const webhooks = pgTable(
  "webhooks",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    targetUrl: text("target_url").notNull(),
    events: webhookEventTypeEnum("events").array().notNull(),
    secret: text("secret").notNull(), // HMAC signing secret for the receiving endpoint to verify payloads
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("webhooks_agency_idx").on(table.agencyId)]
);

/** One delivery attempt of a webhook event — kept for retries and debugging. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: webhookEventTypeEnum("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    ...timestamps,
  },
  (table) => [index("webhook_deliveries_webhook_status_idx").on(table.webhookId, table.status)]
);

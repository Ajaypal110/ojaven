import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { activityTypeEnum, entityTypeEnum, taskPriorityEnum, taskStatusEnum } from "./_enums";
import { agencies, users } from "./identity";

/**
 * Unified activity timeline (notes, calls, meetings, emails) attached to
 * any entity — polymorphic, so entityId has no FK constraint.
 */
export const activities = pgTable(
  "activities",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    type: activityTypeEnum("type").notNull(),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    index("activities_entity_idx").on(table.entityType, table.entityId),
    index("activities_agency_occurred_idx").on(table.agencyId, table.occurredAt),
  ]
);

/** A to-do, optionally linked to any entity (client, deal, ...) via entityId. */
export const tasks = pgTable(
  "tasks",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type"), // nullable — a task doesn't have to be attached to anything
    entityId: uuid("entity_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("tasks_agency_status_idx").on(table.agencyId, table.status),
    index("tasks_assignee_idx").on(table.assigneeId),
    index("tasks_entity_idx").on(table.entityType, table.entityId),
    index("tasks_agency_due_idx").on(table.agencyId, table.dueAt),
  ]
);

import { boolean, date, index, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { dealStatusEnum } from "./_enums";
import { agencies, users } from "./identity";
import { clients } from "./crm";

/** An agency can run multiple pipelines (e.g. "New Business" vs "Upsells"). */
export const pipelines = pgTable(
  "pipelines",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
    ...softDelete, // archive semantics — service guard refuses while open deals exist
  },
  (table) => [index("pipelines_agency_idx").on(table.agencyId)]
);

/** Ordered stages within a pipeline (kanban columns). */
export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    closeProbability: integer("close_probability").notNull().default(0), // 0-100, stage-default win %
    ...timestamps,
    ...softDelete, // archive semantics — service guard refuses while active deals sit in the stage
  },
  (table) => [
    index("pipeline_stages_pipeline_idx").on(table.pipelineId),
    unique("pipeline_stages_pipeline_sort_unique").on(table.pipelineId, table.sortOrder),
  ]
);

/** A sales opportunity moving through a pipeline. */
export const deals = pgTable(
  "deals",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    // restrict, not cascade: client deletion is soft (join-filtered deal
    // visibility, zero-mutation restore) — a HARD client delete destroying
    // deals with no recovery would undercut deals.deletedAt entirely.
    // Verified empirically that restrict does not break the agency-level
    // cascade diamond (deals fall via agencyId in the same statement).
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    value: numeric("value", { precision: 12, scale: 2 }).notNull().default("0"),
    mrr: numeric("mrr", { precision: 12, scale: 2 }), // recurring component of the deal, if any
    closeProbability: integer("close_probability").notNull().default(0), // 0-100, overrides stage default once set
    status: dealStatusEnum("status").notNull().default("open"),
    expectedCloseDate: date("expected_close_date"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("deals_agency_status_idx").on(table.agencyId, table.status),
    index("deals_client_idx").on(table.clientId),
    index("deals_stage_idx").on(table.stageId),
    index("deals_agency_created_idx").on(table.agencyId, table.createdAt),
  ]
);

import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { integrationProviderEnum, integrationStatusEnum, reportStatusEnum } from "./_enums";
import { agencies, users } from "./identity";
import { clients } from "./crm";

/** A per-client OAuth connection to an external data source (GA4, Meta Ads, ...). */
export const integrations = pgTable(
  "integrations",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    status: integrationStatusEnum("status").notNull().default("connected"),
    externalAccountId: text("external_account_id"), // the connected GA4 property id, ad account id, etc.
    // OAuth tokens are NEVER stored in plaintext here — this holds a reference
    // (e.g. a Nango connection id) to the actual token, held by the integration
    // provider/vault, not our own DB.
    connectionRef: text("connection_ref"),
    connectedById: text("connected_by_id").references(() => users.id, { onDelete: "set null" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("integrations_client_provider_unique").on(table.clientId, table.provider),
    index("integrations_agency_status_idx").on(table.agencyId, table.status),
  ]
);

/** A saved collection of widgets — either an agency-internal dashboard or a client-facing one. */
export const dashboards = pgTable(
  "dashboards",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }), // null = agency-internal
    name: text("name").notNull(),
    isClientVisible: boolean("is_client_visible").notNull().default(false), // shown in the client portal
    ...timestamps,
  },
  (table) => [index("dashboards_agency_client_idx").on(table.agencyId, table.clientId)]
);

/** A single chart/metric tile on a dashboard. */
export const widgets = pgTable(
  "widgets",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").references(() => integrations.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    chartType: text("chart_type").notNull(), // "line" | "bar" | "number" | "table" — kept as text (Recharts-driven, expands often)
    metricConfig: jsonb("metric_config").notNull().default({}), // which metric, date range, dimensions
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("widgets_dashboard_idx").on(table.dashboardId)]
);

/** A generated/scheduled report (e.g. monthly client PDF). */
export const reports = pgTable(
  "reports",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    dashboardId: uuid("dashboard_id").references(() => dashboards.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    scheduleCron: text("schedule_cron"), // null = one-off, else recurring via Trigger.dev
    ...timestamps,
  },
  (table) => [index("reports_agency_client_idx").on(table.agencyId, table.clientId)]
);

/** One rendered instance of a report (a specific month's PDF, etc.). */
export const reportGenerations = pgTable(
  "report_generations",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    status: reportStatusEnum("status").notNull().default("pending"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    fileUrl: text("file_url"), // R2 URL once rendered
    error: text("error"),
    ...timestamps,
  },
  (table) => [index("report_generations_report_idx").on(table.reportId, table.createdAt)]
);

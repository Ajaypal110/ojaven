import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { clientStatusEnum, entityTypeEnum, fieldTypeEnum } from "./_enums";
import { agencies, users } from "./identity";

/**
 * The agency's customer company. Core CRM entity — most other modules
 * (deals, tasks, time entries, invoices, integrations...) hang off this.
 */
export const clients = pgTable(
  "clients",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    website: text("website"),
    industry: text("industry"),
    status: clientStatusEnum("status").notNull().default("prospect"),
    healthScore: integer("health_score"), // 0-100, algorithm TBD
    healthScoreCalculatedAt: timestamp("health_score_calculated_at", { withTimezone: true }), // null = never computed; check against this to detect staleness
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }), // agency-side account owner
    // No stored `mrr` column: deliberately computed at read time from
    // sum(deals.mrr) where clientId = this + deals.status = 'won', to avoid
    // a snapshot column drifting out of sync with no write path keeping it
    // current. Add a query helper for this in packages/server, not a column here.
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("clients_agency_status_idx").on(table.agencyId, table.status),
    index("clients_agency_created_idx").on(table.agencyId, table.createdAt),
  ]
);

/** A person at a client company (not necessarily a portal login). */
export const clientContacts = pgTable(
  "client_contacts",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    check(
      "client_contacts_email_lowercase",
      sql`${table.email} IS NULL OR ${table.email} = lower(${table.email})`
    ),
    index("client_contacts_client_idx").on(table.clientId),
    index("client_contacts_agency_idx").on(table.agencyId),
  ]
);

/**
 * Client-portal login. A client_contact optionally becomes a client_user
 * once they're given portal access — separate from clientContacts because
 * not every contact logs in, and this is the row that links to Clerk.
 */
export const clientUsers = pgTable(
  "client_users",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => clientContacts.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }), // Clerk-backed login, NOT an org member
    ...timestamps,
    ...softDelete,
  },
  (table) => [unique("client_users_client_user_unique").on(table.clientId, table.userId)]
);

/** Agency-defined extra fields on any entity (clients, deals, contacts, ...). */
export const customFields = pgTable(
  "custom_fields",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    name: text("name").notNull(),
    fieldType: fieldTypeEnum("field_type").notNull(),
    options: text("options").array(), // choices, when field_type = 'select'
    isRequired: boolean("is_required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("custom_fields_agency_entity_idx").on(table.agencyId, table.entityType)]
);

/** The actual value of a custom field on a specific entity row (polymorphic — no FK on entityId). */
export const customFieldValues = pgTable(
  "custom_field_values",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    customFieldId: uuid("custom_field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    value: text("value"),
    ...timestamps,
  },
  (table) => [
    unique("custom_field_values_field_entity_unique").on(table.customFieldId, table.entityId),
    index("custom_field_values_entity_idx").on(table.entityType, table.entityId),
  ]
);

/** Agency-defined labels, reusable across entity types. */
export const tags = pgTable(
  "tags",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"), // hex
    ...timestamps,
  },
  (table) => [unique("tags_agency_name_unique").on(table.agencyId, table.name)]
);

/** Polymorphic join table — which entities a tag is attached to. */
export const entityTags = pgTable(
  "entity_tags",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    unique("entity_tags_tag_entity_unique").on(table.tagId, table.entityId),
    index("entity_tags_entity_idx").on(table.entityType, table.entityId),
  ]
);

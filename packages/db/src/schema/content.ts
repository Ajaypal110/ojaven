import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { contentStatusEnum } from "./_enums";
import { agencies, users } from "./identity";
import { clients } from "./crm";

/** Metadata for a file uploaded to Cloudflare R2 — the bucket only ever sees signed URLs, never raw credentials. */
export const files = pgTable(
  "files",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }), // null = agency-internal file
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    r2Key: text("r2_key").notNull().unique(), // object key within the bucket
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [index("files_agency_client_idx").on(table.agencyId, table.clientId)]
);

/** A piece of content (blog post, ad copy, social post) going through client approval. */
export const contentItems = pgTable(
  "content_items",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }), // attached asset, if any
    title: text("title").notNull(),
    body: text("body"),
    contentType: text("content_type").notNull(), // "blog" | "ad" | "social" — kept as text, agency-extensible
    status: contentStatusEnum("status").notNull().default("draft"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedById: text("reviewed_by_id").references(() => users.id, { onDelete: "set null" }), // set once a client_user approves/rejects
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("content_items_agency_status_idx").on(table.agencyId, table.status),
    index("content_items_client_idx").on(table.clientId),
  ]
);

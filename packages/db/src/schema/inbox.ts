import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { messageChannelEnum, messageDirectionEnum } from "./_enums";
import { agencies, users } from "./identity";
import { clientContacts, clients } from "./crm";

/** One message in the unified inbox — email, SMS, WhatsApp, or Instagram DM, in or out. */
export const messages = pgTable(
  "messages",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => clientContacts.id, { onDelete: "set null" }),
    teamMemberUserId: text("team_member_user_id").references(() => users.id, {
      onDelete: "set null",
    }), // sender, for outbound; assigned handler, for inbound
    channel: messageChannelEnum("channel").notNull(),
    direction: messageDirectionEnum("direction").notNull(),
    externalId: text("external_id"), // provider's message id (Twilio SID, email Message-ID, etc.) for dedup/threading
    body: text("body").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("messages_agency_client_idx").on(table.agencyId, table.clientId),
    index("messages_agency_received_idx").on(table.agencyId, table.receivedAt),
  ]
);

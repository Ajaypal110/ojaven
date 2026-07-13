import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import {
  automationActionTypeEnum,
  automationTriggerTypeEnum,
  emailSendStatusEnum,
} from "./_enums";
import { agencies } from "./identity";
import { clientContacts } from "./crm";

export const emailTemplates = pgTable(
  "email_templates",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    ...timestamps,
  },
  (table) => [index("email_templates_agency_idx").on(table.agencyId)]
);

/** A multi-step drip sequence built from templates. */
export const emailSequences = pgTable(
  "email_sequences",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("email_sequences_agency_idx").on(table.agencyId)]
);

export const emailSequenceSteps = pgTable(
  "email_sequence_steps",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => emailSequences.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => emailTemplates.id, { onDelete: "restrict" }),
    stepOrder: integer("step_order").notNull(),
    delayHours: integer("delay_hours").notNull().default(0), // hours after the previous step (or enrollment, for step 1)
    ...timestamps,
  },
  (table) => [
    unique("email_sequence_steps_sequence_order_unique").on(table.sequenceId, table.stepOrder),
  ]
);

/** An individual outbound send — one row per recipient per step, for open/click tracking. */
export const emailSends = pgTable(
  "email_sends",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    sequenceStepId: uuid("sequence_step_id").references(() => emailSequenceSteps.id, {
      onDelete: "set null",
    }),
    recipientContactId: uuid("recipient_contact_id").references(() => clientContacts.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),
    resendMessageId: text("resend_message_id"), // Resend's id, for webhook status updates
    status: emailSendStatusEnum("status").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("email_sends_agency_status_idx").on(table.agencyId, table.status),
    index("email_sends_recipient_idx").on(table.recipientContactId),
  ]
);

/** A workflow: when {trigger} happens, do {actions}. */
export const automations = pgTable(
  "automations",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("automations_agency_idx").on(table.agencyId)]
);

export const automationTriggers = pgTable(
  "automation_triggers",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    type: automationTriggerTypeEnum("type").notNull(),
    config: jsonb("config").notNull().default({}), // e.g. { toStageId: "..." } for deal_stage_changed
    ...timestamps,
  },
  (table) => [index("automation_triggers_automation_idx").on(table.automationId)]
);

export const automationActions = pgTable(
  "automation_actions",
  {
    ...id,
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    type: automationActionTypeEnum("type").notNull(),
    config: jsonb("config").notNull().default({}), // e.g. { templateId: "..." } for send_email
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("automation_actions_automation_idx").on(table.automationId)]
);

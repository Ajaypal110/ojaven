import { pgEnum } from "drizzle-orm/pg-core";

// ── Identity ────────────────────────────────────────────────────────────
export const teamMemberRoleEnum = pgEnum("team_member_role", [
  "owner",
  "admin",
  "manager",
  "operator",
]);
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);

// ── CRM ─────────────────────────────────────────────────────────────────
export const clientStatusEnum = pgEnum("client_status", [
  "prospect",
  "active",
  "paused",
  "churned",
]);
export const fieldTypeEnum = pgEnum("field_type", [
  "text",
  "number",
  "date",
  "boolean",
  "select",
  "url",
]);
// Shared across polymorphic tables: tags, custom field values, activities, notifications, audit logs.
export const entityTypeEnum = pgEnum("entity_type", [
  "client",
  "client_contact",
  "deal",
  "task",
  "proposal",
  "invoice",
  "content_item",
]);

// ── Pipeline ────────────────────────────────────────────────────────────
export const dealStatusEnum = pgEnum("deal_status", ["open", "won", "lost"]);

// ── Activities / Tasks ─────────────────────────────────────────────────
export const activityTypeEnum = pgEnum("activity_type", ["note", "call", "meeting", "email"]);
export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "done",
  "cancelled",
]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);

// ── Email / Automation ──────────────────────────────────────────────────
export const emailSendStatusEnum = pgEnum("email_send_status", [
  "queued",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "failed",
]);
export const automationTriggerTypeEnum = pgEnum("automation_trigger_type", [
  "deal_stage_changed",
  "task_completed",
  "client_created",
  "form_submitted",
  "date_based",
]);
export const automationActionTypeEnum = pgEnum("automation_action_type", [
  "send_email",
  "create_task",
  "update_deal_stage",
  "send_notification",
  "call_webhook",
]);

// ── Reporting ───────────────────────────────────────────────────────────
export const integrationProviderEnum = pgEnum("integration_provider", [
  "google_analytics",
  "google_search_console",
  "google_ads",
  "meta_ads",
  "linkedin_ads",
  "shopify",
]);
export const integrationStatusEnum = pgEnum("integration_status", [
  "connected",
  "disconnected",
  "error",
  "expired",
]);
export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "generating",
  "ready",
  "failed",
]);

// ── Content ─────────────────────────────────────────────────────────────
export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "published",
]);

// ── Billing ─────────────────────────────────────────────────────────────
export const proposalStatusEnum = pgEnum("proposal_status", [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "overdue",
  "void",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
]);

// ── Inbox ───────────────────────────────────────────────────────────────
export const messageChannelEnum = pgEnum("message_channel", [
  "email",
  "sms",
  "whatsapp",
  "instagram_dm",
]);
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

// ── Infrastructure ──────────────────────────────────────────────────────
export const notificationTypeEnum = pgEnum("notification_type", [
  "mention",
  "assignment",
  "deal_update",
  "invoice_paid",
  "task_due",
  "system",
]);
export const webhookEventTypeEnum = pgEnum("webhook_event_type", [
  "deal.won",
  "invoice.paid",
  "client.created",
  "task.completed",
]);
export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "success",
  "failed",
]);

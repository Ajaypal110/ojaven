import { z } from "zod";
import { proposalLineItemSchema } from "./proposal";

export const invoiceStatusValues = ["draft", "sent", "paid", "overdue", "void"] as const;
export type InvoiceStatus = (typeof invoiceStatusValues)[number];

// Identical shape to proposal line items (that identity is what makes the
// snapshot-copy conversion trivial).
export const invoiceLineItemSchema = proposalLineItemSchema;

export const createInvoiceSchema = z.object({
  clientId: z.string().uuid(),
  dueDate: z.string().datetime().optional().nullable(),
  tax: z.number().min(0).max(9_999_999_999).default(0), // manual amount; rates deferred
  lineItems: z.array(invoiceLineItemSchema).max(200).optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  id: z.string().uuid(),
  dueDate: z.string().datetime().nullable().optional(),
  tax: z.number().min(0).max(9_999_999_999).optional(), // no default — the .partial() lesson
  lineItems: z.array(invoiceLineItemSchema).max(200).optional(),
});
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const invoiceIdSchema = z.object({ id: z.string().uuid() });

export const listInvoicesSchema = z.object({
  clientId: z.string().uuid().optional(),
  status: z.enum(invoiceStatusValues).optional(), // "overdue" filter is derived in the service
});

export const convertProposalSchema = z.object({
  proposalId: z.string().uuid(),
  dueDate: z.string().datetime().optional().nullable(),
  tax: z.number().min(0).max(9_999_999_999).default(0),
});
export type ConvertProposalInput = z.infer<typeof convertProposalSchema>;

export const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive("Amount must be positive").max(9_999_999_999),
  paidAt: z.string().datetime().optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const paymentIdSchema = z.object({ paymentId: z.string().uuid() });

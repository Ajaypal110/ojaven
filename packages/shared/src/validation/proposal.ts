import { z } from "zod";

export const proposalStatusValues = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
] as const;
export type ProposalStatus = (typeof proposalStatusValues)[number];

export const proposalLineItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(500),
  quantity: z.number().positive("Quantity must be positive").max(999999),
  unitPrice: z.number().min(0, "Price can't be negative").max(9_999_999_999),
});
export type ProposalLineItemInput = z.infer<typeof proposalLineItemSchema>;

// clientId is identity (a proposal belongs to a client) — set at create, never
// updated. dealId is association — editable. Same principle as tasks.
export const createProposalSchema = z.object({
  clientId: z.string().uuid(),
  dealId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1, "Title is required").max(300),
  bodyHtml: z.string().max(100_000).optional(), // sanitized server-side, not here
  lineItems: z.array(proposalLineItemSchema).max(200).optional(),
});
export type CreateProposalInput = z.infer<typeof createProposalSchema>;

export const updateProposalSchema = z.object({
  id: z.string().uuid(),
  dealId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  bodyHtml: z.string().max(100_000).optional(),
  lineItems: z.array(proposalLineItemSchema).max(200).optional(),
});
export type UpdateProposalInput = z.infer<typeof updateProposalSchema>;

export const proposalIdSchema = z.object({ id: z.string().uuid() });

export const listProposalsSchema = z.object({
  clientId: z.string().uuid().optional(),
  status: z.enum(proposalStatusValues).optional(),
});

// ── Public (unauthenticated) ────────────────────────────────────────────────
const tokenField = z.string().min(20).max(200);

export const proposalTokenSchema = z.object({ token: tokenField });

export const respondToProposalSchema = z
  .object({
    token: tokenField,
    decision: z.enum(["accept", "decline"]),
    signedByName: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.decision !== "accept" || Boolean(v.signedByName && v.signedByName.length > 0), {
    message: "Type your name to accept.",
    path: ["signedByName"],
  });
export type RespondToProposalInput = z.infer<typeof respondToProposalSchema>;

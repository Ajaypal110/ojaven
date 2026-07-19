import { z } from "zod";

export const dealStatusValues = ["open", "won", "lost"] as const;

// Shared field shapes, no defaults baked in (the updateClientSchema
// lesson: defaults survive .partial() and silently reset on updates).
// Money comes in as numbers; the service converts to fixed-2 strings for
// the numeric(12,2) columns.
const dealFields = {
  name: z.string().trim().min(1, "Name is required").max(200),
  value: z.number().nonnegative().max(9_999_999_999.99),
  mrr: z.number().nonnegative().max(9_999_999_999.99).nullable(),
  closeProbability: z.number().int().min(0).max(100),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable(),
};

export const createDealSchema = z.object({
  clientId: z.string().uuid(),
  name: dealFields.name,
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  value: dealFields.value.optional(),
  mrr: dealFields.mrr.optional(),
  closeProbability: dealFields.closeProbability.optional(),
  expectedCloseDate: dealFields.expectedCloseDate.optional(),
});
export type CreateDealInput = z.infer<typeof createDealSchema>;

export const updateDealSchema = z.object({
  id: z.string().uuid(),
  name: dealFields.name.optional(),
  value: dealFields.value.optional(),
  mrr: dealFields.mrr.optional(),
  closeProbability: dealFields.closeProbability.optional(),
  expectedCloseDate: dealFields.expectedCloseDate.optional(),
});
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

export const moveDealStageSchema = z.object({
  id: z.string().uuid(),
  stageId: z.string().uuid(),
});
export type MoveDealStageInput = z.infer<typeof moveDealStageSchema>;

export const setDealStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(dealStatusValues),
});
export type SetDealStatusInput = z.infer<typeof setDealStatusSchema>;

export const dealIdSchema = z.object({ id: z.string().uuid() });

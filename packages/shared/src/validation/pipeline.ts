import { z } from "zod";

export const createPipelineSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
});
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

export const renamePipelineSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(200),
});
export type RenamePipelineInput = z.infer<typeof renamePipelineSchema>;

export const pipelineIdSchema = z.object({ id: z.string().uuid() });

export const createStageSchema = z.object({
  pipelineId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(200),
  closeProbability: z.number().int().min(0).max(100).optional(),
});
export type CreateStageInput = z.infer<typeof createStageSchema>;

// Partial WITHOUT baked defaults — a field default survives .partial() and
// would silently reset values on updates that don't send the key (the
// updateClientSchema lesson).
export const updateStageSchema = z.object({
  stageId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  closeProbability: z.number().int().min(0).max(100).optional(),
});
export type UpdateStageInput = z.infer<typeof updateStageSchema>;

export const reorderStagesSchema = z.object({
  pipelineId: z.string().uuid(),
  orderedStageIds: z.array(z.string().uuid()).min(1),
});
export type ReorderStagesInput = z.infer<typeof reorderStagesSchema>;

export const stageIdSchema = z.object({ stageId: z.string().uuid() });

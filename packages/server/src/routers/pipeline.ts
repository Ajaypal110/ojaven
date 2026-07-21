import {
  createPipelineSchema,
  createStageSchema,
  pipelineIdSchema,
  renamePipelineSchema,
  reorderStagesSchema,
  stageIdSchema,
  updateStageSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import { assertStructureRole } from "../roleGuards";
import {
  archivePipeline,
  archiveStage,
  createPipeline,
  createStage,
  ensureDefaultPipeline,
  listPipelines,
  renamePipeline,
  reorderStages,
  updateStage,
} from "../services/pipeline";

export const pipelineRouter = router({
  list: agencyProcedure.query(({ ctx }) => listPipelines(ctx.agencyId)),

  ensureDefault: teamProcedure.mutation(({ ctx }) => {
    assertStructureRole(ctx.teamMember.role, "pipeline structure");
    return ensureDefaultPipeline(ctx.agencyId);
  }),

  create: teamProcedure.input(createPipelineSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "pipeline structure");
    return createPipeline({ agencyId: ctx.agencyId, name: input.name });
  }),

  rename: teamProcedure.input(renamePipelineSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "pipeline structure");
    return renamePipeline({ agencyId: ctx.agencyId, id: input.id, name: input.name });
  }),

  archive: teamProcedure.input(pipelineIdSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "pipeline structure");
    return archivePipeline({ agencyId: ctx.agencyId, id: input.id });
  }),

  createStage: teamProcedure.input(createStageSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "pipeline structure");
    return createStage({
      agencyId: ctx.agencyId,
      pipelineId: input.pipelineId,
      name: input.name,
      closeProbability: input.closeProbability,
    });
  }),

  updateStage: teamProcedure.input(updateStageSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "pipeline structure");
    return updateStage({
      agencyId: ctx.agencyId,
      stageId: input.stageId,
      name: input.name,
      closeProbability: input.closeProbability,
    });
  }),

  reorderStages: teamProcedure.input(reorderStagesSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "pipeline structure");
    return reorderStages({
      agencyId: ctx.agencyId,
      pipelineId: input.pipelineId,
      orderedStageIds: input.orderedStageIds,
    });
  }),

  archiveStage: teamProcedure.input(stageIdSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "pipeline structure");
    return archiveStage({ agencyId: ctx.agencyId, stageId: input.stageId });
  }),
});

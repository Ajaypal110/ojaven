import { TRPCError } from "@trpc/server";
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

type TeamRole = "owner" | "admin" | "manager" | "operator";

/**
 * The data-vs-structure permission split (named as a pattern in the
 * pipeline design review): DEAL operations are data — all four roles, via
 * agencyProcedure, same as clients. Pipeline/stage STRUCTURE is agency
 * configuration — owner/admin only, like settings. Every future module
 * answers this question explicitly: which procedures touch data, which
 * touch structure.
 */
function assertStructureRole(role: TeamRole) {
  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only owners and admins can change pipeline structure.",
    });
  }
}

export const pipelineRouter = router({
  list: agencyProcedure.query(({ ctx }) => listPipelines(ctx.agencyId)),

  ensureDefault: teamProcedure.mutation(({ ctx }) => {
    assertStructureRole(ctx.teamMember.role);
    return ensureDefaultPipeline(ctx.agencyId);
  }),

  create: teamProcedure.input(createPipelineSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role);
    return createPipeline({ agencyId: ctx.agencyId, name: input.name });
  }),

  rename: teamProcedure.input(renamePipelineSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role);
    return renamePipeline({ agencyId: ctx.agencyId, id: input.id, name: input.name });
  }),

  archive: teamProcedure.input(pipelineIdSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role);
    return archivePipeline({ agencyId: ctx.agencyId, id: input.id });
  }),

  createStage: teamProcedure.input(createStageSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role);
    return createStage({
      agencyId: ctx.agencyId,
      pipelineId: input.pipelineId,
      name: input.name,
      closeProbability: input.closeProbability,
    });
  }),

  updateStage: teamProcedure.input(updateStageSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role);
    return updateStage({
      agencyId: ctx.agencyId,
      stageId: input.stageId,
      name: input.name,
      closeProbability: input.closeProbability,
    });
  }),

  reorderStages: teamProcedure.input(reorderStagesSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role);
    return reorderStages({
      agencyId: ctx.agencyId,
      pipelineId: input.pipelineId,
      orderedStageIds: input.orderedStageIds,
    });
  }),

  archiveStage: teamProcedure.input(stageIdSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role);
    return archiveStage({ agencyId: ctx.agencyId, stageId: input.stageId });
  }),
});

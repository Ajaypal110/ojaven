import { z } from "zod";
import {
  createDealSchema,
  dealIdSchema,
  moveDealStageSchema,
  setDealStatusSchema,
  updateDealSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";
import {
  createDeal,
  deleteDeal,
  getDealById,
  listDeals,
  moveDealStage,
  setDealStatus,
  updateDeal,
} from "../services/deals";

/**
 * All deal operations are DATA per the matrix — every role, via
 * agencyProcedure, matching clientRouter. Structure lives in
 * pipelineRouter behind owner/admin. See the pattern note there.
 */
export const dealsRouter = router({
  list: agencyProcedure
    .input(z.object({ pipelineId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      listDeals({ agencyId: ctx.agencyId, pipelineId: input?.pipelineId })
    ),

  byId: agencyProcedure.input(dealIdSchema).query(({ ctx, input }) =>
    getDealById({ agencyId: ctx.agencyId, id: input.id })
  ),

  create: agencyProcedure.input(createDealSchema).mutation(({ ctx, input }) =>
    createDeal({ agencyId: ctx.agencyId, actorUserId: ctx.userId, input })
  ),

  update: agencyProcedure.input(updateDealSchema).mutation(({ ctx, input }) =>
    updateDeal({ agencyId: ctx.agencyId, input })
  ),

  moveStage: agencyProcedure.input(moveDealStageSchema).mutation(({ ctx, input }) =>
    moveDealStage({ agencyId: ctx.agencyId, id: input.id, stageId: input.stageId })
  ),

  setStatus: agencyProcedure.input(setDealStatusSchema).mutation(({ ctx, input }) =>
    setDealStatus({ agencyId: ctx.agencyId, id: input.id, status: input.status })
  ),

  delete: agencyProcedure.input(dealIdSchema).mutation(({ ctx, input }) =>
    deleteDeal({ agencyId: ctx.agencyId, id: input.id })
  ),
});

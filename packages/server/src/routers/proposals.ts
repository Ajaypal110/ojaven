import {
  createProposalSchema,
  listProposalsSchema,
  proposalIdSchema,
  updateProposalSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";
import {
  createProposal,
  deleteProposal,
  getProposalById,
  listProposals,
  sendProposal,
  updateProposal,
} from "../services/proposals";

// Proposals are DATA (all roles, agencyProcedure) — day-to-day sales work.
// draft-only-edit, accepted-delete-protection, and token minting live in the
// service.
export const proposalsRouter = router({
  list: agencyProcedure
    .input(listProposalsSchema)
    .query(({ ctx, input }) =>
      listProposals({ agencyId: ctx.agencyId, clientId: input.clientId, status: input.status })
    ),

  byId: agencyProcedure
    .input(proposalIdSchema)
    .query(({ ctx, input }) => getProposalById({ agencyId: ctx.agencyId, id: input.id })),

  create: agencyProcedure
    .input(createProposalSchema)
    .mutation(({ ctx, input }) =>
      createProposal({ agencyId: ctx.agencyId, actorUserId: ctx.userId, input })
    ),

  update: agencyProcedure
    .input(updateProposalSchema)
    .mutation(({ ctx, input }) => updateProposal({ agencyId: ctx.agencyId, input })),

  send: agencyProcedure
    .input(proposalIdSchema)
    .mutation(({ ctx, input }) => sendProposal({ agencyId: ctx.agencyId, id: input.id })),

  delete: agencyProcedure
    .input(proposalIdSchema)
    .mutation(({ ctx, input }) => deleteProposal({ agencyId: ctx.agencyId, id: input.id })),
});

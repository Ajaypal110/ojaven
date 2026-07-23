import { proposalTokenSchema, respondToProposalSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { publicProcedure } from "../procedures";
import {
  getProposalByToken,
  markProposalViewed,
  respondToProposal,
} from "../services/publicProposals";

/**
 * The app's first UNAUTHENTICATED surface. publicProcedure = rate-limited (now
 * per-IP for anonymous callers), no auth. The token is a capability credential:
 * each endpoint is scoped to the single proposal it resolves, drafts/deleted
 * are unreachable, wrong tokens return a uniform NOT_FOUND, and the token is
 * never echoed. Served at /p/[token] outside the (product) Clerk layout.
 */
export const publicRouter = router({
  getProposal: publicProcedure
    .input(proposalTokenSchema)
    .query(({ input }) => getProposalByToken(input.token)),

  markProposalViewed: publicProcedure
    .input(proposalTokenSchema)
    .mutation(({ input }) => markProposalViewed(input.token)),

  respondToProposal: publicProcedure
    .input(respondToProposalSchema)
    .mutation(({ input }) => respondToProposal(input)),
});

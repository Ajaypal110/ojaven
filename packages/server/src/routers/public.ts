import { proposalTokenSchema, respondToProposalSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { publicProcedure } from "../procedures";
import {
  getProposalByToken,
  markProposalViewed,
  respondToProposal,
} from "../services/publicProposals";
import { getInvoiceByToken, markInvoiceViewed } from "../services/publicInvoices";

/**
 * The app's unauthenticated surface (proposals /p, invoices /i). publicProcedure
 * = rate-limited per-IP for anonymous callers, no auth. Every endpoint is keyed
 * by a 256-bit capability token scoped to a single document; drafts are
 * unreachable, wrong tokens return a uniform NOT_FOUND, tokens are never
 * echoed. Served outside the (product) Clerk layout.
 */
export const publicRouter = router({
  // ── Proposals (/p/[token]) ────────────────────────────────────────────
  getProposal: publicProcedure
    .input(proposalTokenSchema)
    .query(({ input }) => getProposalByToken(input.token)),

  markProposalViewed: publicProcedure
    .input(proposalTokenSchema)
    .mutation(({ input }) => markProposalViewed(input.token)),

  respondToProposal: publicProcedure
    .input(respondToProposalSchema)
    .mutation(({ input }) => respondToProposal(input)),

  // ── Invoices (/i/[token]) — view-only; VOID stays visible ─────────────
  getInvoice: publicProcedure
    .input(proposalTokenSchema)
    .query(({ input }) => getInvoiceByToken(input.token)),

  markInvoiceViewed: publicProcedure
    .input(proposalTokenSchema)
    .mutation(({ input }) => markInvoiceViewed(input.token)),
});

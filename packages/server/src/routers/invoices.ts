import {
  convertProposalSchema,
  createInvoiceSchema,
  invoiceIdSchema,
  listInvoicesSchema,
  paymentIdSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import { assertStructureRole } from "../roleGuards";
import {
  convertProposalToInvoice,
  createInvoice,
  getInvoiceById,
  listInvoices,
  markPaymentRefunded,
  recordPayment,
  sendInvoice,
  updateInvoice,
  voidInvoice,
} from "../services/invoices";

// Issuing invoices and recording payments is daily billing ops -> data
// (agencyProcedure, all roles). UNWINDING an issued financial record — void,
// refund — is a management act -> owner/admin (teamProcedure + structure gate).
export const invoicesRouter = router({
  list: agencyProcedure
    .input(listInvoicesSchema)
    .query(({ ctx, input }) =>
      listInvoices({ agencyId: ctx.agencyId, clientId: input.clientId, status: input.status })
    ),

  byId: agencyProcedure
    .input(invoiceIdSchema)
    .query(({ ctx, input }) => getInvoiceById({ agencyId: ctx.agencyId, id: input.id })),

  create: agencyProcedure
    .input(createInvoiceSchema)
    .mutation(({ ctx, input }) => createInvoice({ agencyId: ctx.agencyId, input })),

  update: agencyProcedure
    .input(updateInvoiceSchema)
    .mutation(({ ctx, input }) => updateInvoice({ agencyId: ctx.agencyId, input })),

  send: agencyProcedure
    .input(invoiceIdSchema)
    .mutation(({ ctx, input }) => sendInvoice({ agencyId: ctx.agencyId, id: input.id })),

  convertFromProposal: agencyProcedure
    .input(convertProposalSchema)
    .mutation(({ ctx, input }) => convertProposalToInvoice({ agencyId: ctx.agencyId, input })),

  recordPayment: agencyProcedure
    .input(recordPaymentSchema)
    .mutation(({ ctx, input }) => recordPayment({ agencyId: ctx.agencyId, input })),

  void: teamProcedure.input(invoiceIdSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "invoice corrections");
    return voidInvoice({ agencyId: ctx.agencyId, id: input.id });
  }),

  markPaymentRefunded: teamProcedure.input(paymentIdSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "invoice corrections");
    return markPaymentRefunded({ agencyId: ctx.agencyId, paymentId: input.paymentId });
  }),
});

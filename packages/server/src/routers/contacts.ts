import { z } from "zod";
import { createContactSchema, updateContactSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";
import {
  createContact,
  deleteContact,
  listContactsByClient,
  updateContact,
} from "../services/contacts";

const idInput = z.object({ id: z.string().uuid() });

// Contacts are DATA, not structure — every agency role can CRUD them, so all
// four are agencyProcedure (never teamProcedure). Correctness — parent-client
// liveness, agency scoping, the at-most-one-primary invariant — lives in the
// service; the router is just the Zod boundary + agencyId injection.
export const contactsRouter = router({
  listByClient: agencyProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(({ ctx, input }) => listContactsByClient(ctx.agencyId, input.clientId)),

  create: agencyProcedure
    .input(createContactSchema)
    .mutation(({ ctx, input }) => createContact({ agencyId: ctx.agencyId, input })),

  update: agencyProcedure
    .input(idInput.merge(updateContactSchema))
    .mutation(({ ctx, input }) => {
      const { id, ...fields } = input;
      return updateContact({ agencyId: ctx.agencyId, id, input: fields });
    }),

  delete: agencyProcedure
    .input(idInput)
    .mutation(({ ctx, input }) => deleteContact({ agencyId: ctx.agencyId, id: input.id })),
});

import { clientRetainerSchema, setRetainerSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import { assertStructureRole } from "../roleGuards";
import { getCurrentRetainer, listRetainers, setRetainer } from "../services/retainers";

// A retainer is a client CONTRACT term — reading it is data (all roles), but
// changing contracted hours is a management decision, so setRetainer is
// structure (owner/admin), like other configuration.
export const retainersRouter = router({
  getCurrent: agencyProcedure
    .input(clientRetainerSchema)
    .query(({ ctx, input }) => getCurrentRetainer(ctx.agencyId, input.clientId)),

  history: agencyProcedure
    .input(clientRetainerSchema)
    .query(({ ctx, input }) => listRetainers(ctx.agencyId, input.clientId)),

  set: teamProcedure.input(setRetainerSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "client retainers");
    return setRetainer({ agencyId: ctx.agencyId, input });
  }),
});

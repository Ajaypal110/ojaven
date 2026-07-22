import {
  listByClientSchema,
  logTimeEntrySchema,
  monthlyRollupSchema,
  timeEntryIdSchema,
  updateTimeEntrySchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import { deleteEntry, listByClient, logEntry, monthlyRollup, updateEntry } from "../services/time";

// Logging/viewing time is DATA (all roles, agencyProcedure). Editing/deleting
// runs the own-or-owner/admin matrix, which needs the caller's role, so those
// two are teamProcedure.
export const timeRouter = router({
  listByClient: agencyProcedure
    .input(listByClientSchema)
    .query(({ ctx, input }) =>
      listByClient({ agencyId: ctx.agencyId, clientId: input.clientId, month: input.month })
    ),

  monthlyRollup: agencyProcedure
    .input(monthlyRollupSchema)
    .query(({ ctx, input }) =>
      monthlyRollup({ agencyId: ctx.agencyId, clientId: input.clientId, month: input.month })
    ),

  logEntry: agencyProcedure
    .input(logTimeEntrySchema)
    .mutation(({ ctx, input }) => logEntry({ agencyId: ctx.agencyId, userId: ctx.userId, input })),

  updateEntry: teamProcedure
    .input(updateTimeEntrySchema)
    .mutation(({ ctx, input }) =>
      updateEntry({
        agencyId: ctx.agencyId,
        actor: { userId: ctx.userId, role: ctx.teamMember.role },
        input,
      })
    ),

  deleteEntry: teamProcedure
    .input(timeEntryIdSchema)
    .mutation(({ ctx, input }) =>
      deleteEntry({
        agencyId: ctx.agencyId,
        actor: { userId: ctx.userId, role: ctx.teamMember.role },
        id: input.id,
      })
    ),
});

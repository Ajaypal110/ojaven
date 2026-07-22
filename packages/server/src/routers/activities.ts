import { addNoteSchema, entityRefSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";
import { addNote, listActivitiesForEntity } from "../services/activities";

// Timeline reads + manual notes are DATA (all roles). The entity guard lives
// in the service (a read guard on the list, a write guard on the note).
export const activitiesRouter = router({
  listForEntity: agencyProcedure
    .input(entityRefSchema)
    .query(({ ctx, input }) =>
      listActivitiesForEntity({
        agencyId: ctx.agencyId,
        entityType: input.entityType,
        entityId: input.entityId,
      })
    ),

  addNote: agencyProcedure
    .input(addNoteSchema)
    .mutation(({ ctx, input }) =>
      addNote({
        agencyId: ctx.agencyId,
        authorId: ctx.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        body: input.body,
      })
    ),
});

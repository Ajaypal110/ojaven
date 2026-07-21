import {
  createTagSchema,
  entityRefSchema,
  tagAttachmentSchema,
  tagIdSchema,
  updateTagSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import { assertStructureRole } from "../roleGuards";
import { attachTag, createTag, deleteTag, detachTag, listTags, listTagsForEntity, updateTag } from "../services/tags";

// Definitions (create/rename/delete a tag) are STRUCTURE -> teamProcedure +
// owner/admin. Attaching a tag to a record and reading tags are DATA -> all
// roles on agencyProcedure. Same split as pipeline.
export const tagsRouter = router({
  list: agencyProcedure.query(({ ctx }) => listTags(ctx.agencyId)),

  create: teamProcedure.input(createTagSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "tags");
    return createTag({ agencyId: ctx.agencyId, input });
  }),

  update: teamProcedure.input(updateTagSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "tags");
    const { id, ...rest } = input;
    return updateTag({ agencyId: ctx.agencyId, id, input: rest });
  }),

  delete: teamProcedure.input(tagIdSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "tags");
    return deleteTag({ agencyId: ctx.agencyId, id: input.id });
  }),

  attach: agencyProcedure
    .input(tagAttachmentSchema)
    .mutation(({ ctx, input }) => attachTag({ agencyId: ctx.agencyId, input })),

  detach: agencyProcedure
    .input(tagAttachmentSchema)
    .mutation(({ ctx, input }) => detachTag({ agencyId: ctx.agencyId, input })),

  listForEntity: agencyProcedure
    .input(entityRefSchema)
    .query(({ ctx, input }) =>
      listTagsForEntity({ agencyId: ctx.agencyId, entityType: input.entityType, entityId: input.entityId })
    ),
});

import {
  contentIdSchema,
  createContentSchema,
  listContentSchema,
  reviewContentSchema,
  updateContentSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import { assertReviewRole } from "../roleGuards";
import {
  createContent,
  deleteContent,
  getContentById,
  listContent,
  publishContent,
  reviewContent,
  submitContent,
  updateContent,
} from "../services/content";

// Writing and submitting content is daily ops -> all roles (agencyProcedure).
// REVIEW is the authority act -> manager and above (the middle tier's first
// outing). Publish is mechanical after approval -> all roles.
export const contentRouter = router({
  list: agencyProcedure
    .input(listContentSchema)
    .query(({ ctx, input }) => listContent({ agencyId: ctx.agencyId, ...input })),

  byId: agencyProcedure
    .input(contentIdSchema)
    .query(({ ctx, input }) => getContentById({ agencyId: ctx.agencyId, id: input.id })),

  create: agencyProcedure
    .input(createContentSchema)
    .mutation(({ ctx, input }) =>
      createContent({ agencyId: ctx.agencyId, actorUserId: ctx.userId, input })
    ),

  update: agencyProcedure
    .input(updateContentSchema)
    .mutation(({ ctx, input }) => updateContent({ agencyId: ctx.agencyId, input })),

  submit: agencyProcedure
    .input(contentIdSchema)
    .mutation(({ ctx, input }) => submitContent({ agencyId: ctx.agencyId, id: input.id })),

  review: teamProcedure.input(reviewContentSchema).mutation(({ ctx, input }) => {
    assertReviewRole(ctx.teamMember.role, "content");
    return reviewContent({ agencyId: ctx.agencyId, actorUserId: ctx.userId, input });
  }),

  publish: agencyProcedure
    .input(contentIdSchema)
    .mutation(({ ctx, input }) => publishContent({ agencyId: ctx.agencyId, id: input.id })),

  delete: agencyProcedure
    .input(contentIdSchema)
    .mutation(({ ctx, input }) => deleteContent({ agencyId: ctx.agencyId, id: input.id })),
});

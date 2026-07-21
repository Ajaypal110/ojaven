import {
  createCustomFieldSchema,
  customFieldIdSchema,
  entityRefSchema,
  listFieldsForEntityTypeSchema,
  setFieldValueSchema,
  updateCustomFieldSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import { assertStructureRole } from "../roleGuards";
import {
  createCustomField,
  deleteCustomField,
  listCustomFields,
  listFieldValuesForEntity,
  setFieldValue,
  updateCustomField,
} from "../services/customFields";

// Field DEFINITIONS are STRUCTURE -> teamProcedure + owner/admin. Reading the
// definitions and setting VALUES are DATA -> all roles on agencyProcedure.
export const customFieldsRouter = router({
  listForEntityType: agencyProcedure
    .input(listFieldsForEntityTypeSchema)
    .query(({ ctx, input }) =>
      listCustomFields({ agencyId: ctx.agencyId, entityType: input.entityType })
    ),

  create: teamProcedure.input(createCustomFieldSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "custom fields");
    return createCustomField({ agencyId: ctx.agencyId, input });
  }),

  update: teamProcedure.input(updateCustomFieldSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "custom fields");
    const { id, ...rest } = input;
    return updateCustomField({ agencyId: ctx.agencyId, id, input: rest });
  }),

  delete: teamProcedure.input(customFieldIdSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "custom fields");
    return deleteCustomField({ agencyId: ctx.agencyId, id: input.id });
  }),

  setValue: agencyProcedure
    .input(setFieldValueSchema)
    .mutation(({ ctx, input }) => setFieldValue({ agencyId: ctx.agencyId, input })),

  listValuesForEntity: agencyProcedure
    .input(entityRefSchema)
    .query(({ ctx, input }) =>
      listFieldValuesForEntity({
        agencyId: ctx.agencyId,
        entityType: input.entityType,
        entityId: input.entityId,
      })
    ),
});

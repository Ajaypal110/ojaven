import { changeSubdomainSchema, updateSettingsSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import { assertStructureRole } from "../roleGuards";
import { changeSubdomain, getSettings, updateSettings } from "../services/settings";

/**
 * Agency settings. Reading is DATA (agencyProcedure, all roles — the app
 * renders branding/timezone). Writing is STRUCTURE (owner/admin), via the
 * shared assertStructureRole guard. Subdomain gets its own procedure with
 * uniqueness + reserved-word handling, kept out of the general update.
 */
export const settingsRouter = router({
  get: agencyProcedure.query(({ ctx }) => getSettings(ctx.agencyId)),

  update: teamProcedure.input(updateSettingsSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "agency settings");
    return updateSettings({ agencyId: ctx.agencyId, patch: input });
  }),

  changeSubdomain: teamProcedure.input(changeSubdomainSchema).mutation(({ ctx, input }) => {
    assertStructureRole(ctx.teamMember.role, "agency settings");
    return changeSubdomain({ agencyId: ctx.agencyId, subdomain: input.subdomain });
  }),
});

import { eq } from "drizzle-orm";
import { agencies } from "@ojaven/db";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";

export const agencyRouter = router({
  /**
   * The first real agencyProcedure query — exists specifically so the
   * onboarding page has something to poll that actually exercises
   * requireAgency / AgencySyncPendingError.
   */
  current: agencyProcedure.query(async ({ ctx }) => {
    const [agency] = await ctx.db
      .select({ id: agencies.id, name: agencies.name })
      .from(agencies)
      .where(eq(agencies.id, ctx.agencyId))
      .limit(1);

    return agency;
  }),
});

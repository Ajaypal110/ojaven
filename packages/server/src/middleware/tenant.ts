import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { agencies } from "@ojaven/db";
import { middleware } from "../trpc";
import { AgencySyncPendingError } from "../errors";

/**
 * The ONLY place multi-tenant enforcement happens — there's no DB-level
 * RLS with Neon, so every agency-scoped query/mutation MUST go through
 * agencyProcedure (which chains this after requireAuth) rather than
 * building `agencyId` from client-supplied input.
 */
export const requireAgency = middleware(async ({ ctx, next }) => {
  if (!ctx.clerkOrgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No active organization selected.",
    });
  }

  const [agency] = await ctx.db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.clerkOrgId, ctx.clerkOrgId))
    .limit(1);

  if (!agency) {
    const cause = new AgencySyncPendingError(ctx.clerkOrgId);
    throw new TRPCError({ code: "NOT_FOUND", message: cause.message, cause });
  }

  return next({ ctx: { ...ctx, agencyId: agency.id } });
});

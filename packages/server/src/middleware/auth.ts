import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { users } from "@ojaven/db";
import { middleware } from "../trpc";
import { liveClerkGateway } from "../services/liveClerkGateway";
import { provisionUserFromClerk } from "../services/userProvisioning";

/**
 * Narrows ctx.userId from `string | null` to `string`, JIT-provisioning the
 * users row for a Clerk user that doesn't have one yet. Lives here (not in
 * requireAgency) because user.me is a plain protectedProcedure that reads
 * the users table directly and would falsely "not find" a real signed-in
 * user without this.
 *
 * The reclaim logic (recycled emails, tombstoning) lives in
 * services/userProvisioning — the single write path shared with the Clerk
 * webhook. This middleware just: fast-path if the row exists, else delegate,
 * and let a CONFLICT (email owned by another live account) propagate with
 * its readable message intact rather than flattening it to a 500.
 */
export const requireAuth = middleware(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
  }

  const [existing] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

  if (!existing) {
    let provisioned: { id: string } | null;
    try {
      provisioned = await provisionUserFromClerk({
        gateway: liveClerkGateway,
        clerkUserId: ctx.userId,
      });
    } catch (err) {
      // A readable CONFLICT (recycled email still owned by a live account)
      // must reach the user verbatim — only wrap the unexpected.
      if (err instanceof TRPCError) throw err;
      ctx.logger.error({ err, clerkUserId: ctx.userId }, "Failed to JIT-provision user");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not provision user record.",
      });
    }

    if (!provisioned) {
      // Clerk has no email for this id — nothing to insert.
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not provision user record.",
      });
    }
  }

  // Partial override, no ...ctx spread: tRPC shallow-merges ctx overrides,
  // and spreading the statically-typed base ctx here would clobber this
  // narrowing for downstream middlewares in the chain.
  return next({ ctx: { userId: ctx.userId } });
});

import { TRPCError } from "@trpc/server";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { agencies } from "@ojaven/db";
import type { Context } from "../context";
import { middleware } from "../trpc";
import { AgencySyncPendingError } from "../errors";

/**
 * JIT-provisions the agencies row for a Clerk org that doesn't have one
 * yet. The organization.created webhook is the primary path once deployed
 * with a reachable public URL, but it's an optimization, not a hard
 * dependency — in local dev (no webhook receiver running at all) or in the
 * gap between org creation and webhook delivery in production, a request
 * can legitimately arrive before the webhook does. Without this,
 * agencyProcedure is permanently broken in local dev.
 *
 * Race-safe: two concurrent requests for the same brand-new org both
 * attempt the insert; onConflictDoNothing (on the existing unique
 * constraint on agencies.clerkOrgId) means at most one actually inserts,
 * the other falls through to the SELECT and gets the same row — this is
 * deliberately not a check-then-insert, which would have a real race
 * window between the two statements.
 */
async function provisionAgency(db: Context["db"], clerkOrgId: string) {
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: clerkOrgId });

  const [inserted] = await db
    .insert(agencies)
    .values({ clerkOrgId, name: org.name })
    .onConflictDoNothing({ target: agencies.clerkOrgId })
    .returning({ id: agencies.id });

  if (inserted) return inserted;

  // Lost the race — another concurrent request (or the webhook, landing
  // mid-flight) already created it. Fetch what they created.
  const [existing] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.clerkOrgId, clerkOrgId))
    .limit(1);

  return existing;
}

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

  const [existing] = await ctx.db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.clerkOrgId, ctx.clerkOrgId))
    .limit(1);

  let agency = existing;

  if (!agency) {
    try {
      agency = await provisionAgency(ctx.db, ctx.clerkOrgId);
    } catch (err) {
      ctx.logger.error(
        { err, clerkOrgId: ctx.clerkOrgId },
        "Failed to JIT-provision agency"
      );
    }
  }

  if (!agency) {
    // Genuinely unexpected at this point (JIT provisioning covers the
    // normal "webhook hasn't run" case) — most likely a transient Clerk
    // API failure. Reuses AgencySyncPendingError so the onboarding page's
    // existing retry UI still applies rather than a raw crash.
    const cause = new AgencySyncPendingError(ctx.clerkOrgId);
    throw new TRPCError({ code: "NOT_FOUND", message: cause.message, cause });
  }

  return next({ ctx: { ...ctx, agencyId: agency.id } });
});

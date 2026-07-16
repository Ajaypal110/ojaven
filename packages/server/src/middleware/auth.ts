import { TRPCError } from "@trpc/server";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { users } from "@ojaven/db";
import type { Context } from "../context";
import { middleware } from "../trpc";

/**
 * JIT-provisions the users row for a Clerk user with no row yet. Same
 * reasoning as agency provisioning in tenant.ts: the user.created webhook
 * is the primary path once deployed with a reachable public URL, not a
 * hard dependency it's safe to block on.
 *
 * Lives in requireAuth specifically (not just requireAgency) because it's
 * needed by every authed route that touches the users table, not only
 * agency-scoped ones — user.me is a plain protectedProcedure and would
 * incorrectly report "not found" for a real, currently-signed-in user
 * without this running first.
 *
 * Race-safe: onConflictDoNothing against the primary key (inherently
 * unique — it IS the Clerk user id) rather than check-then-insert.
 */
async function provisionUser(db: Context["db"], clerkUserId: string) {
  const client = await clerkClient();
  const clerkUser = await client.users.getUser(clerkUserId);

  const email = clerkUser.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId
  )?.emailAddress;

  if (!email) return undefined;

  const [inserted] = await db
    .insert(users)
    .values({
      id: clerkUserId,
      email: email.toLowerCase(),
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      imageUrl: clerkUser.imageUrl,
    })
    .onConflictDoNothing({ target: users.id })
    .returning({ id: users.id });

  if (inserted) return inserted;

  // Lost the race — another concurrent request (or the webhook, landing
  // mid-flight) already created it. Fetch what they created.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, clerkUserId))
    .limit(1);

  return existing;
}

/** Narrows ctx.userId from `string | null` to `string` for everything downstream. */
export const requireAuth = middleware(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
  }

  const [existing] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

  let user = existing;

  if (!user) {
    try {
      user = await provisionUser(ctx.db, ctx.userId);
    } catch (err) {
      ctx.logger.error({ err, clerkUserId: ctx.userId }, "Failed to JIT-provision user");
    }
  }

  if (!user) {
    // Fails the whole request here rather than letting it proceed with a
    // userId that has no backing row — every downstream FK (clients.owner_id,
    // etc.) would just fail later anyway, further from the actual cause.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not provision user record.",
    });
  }

  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

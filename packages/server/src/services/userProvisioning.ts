import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import { db, users } from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import type { ClerkGateway } from "./clerkGateway";
import { lockKey } from "./agencyLock";

/**
 * The reserved email a tombstoned orphan row is renamed to — keyed on the
 * old Clerk id so it's globally unique and idempotent to reapply. The id is
 * hex-encoded, NOT embedded raw: real Clerk ids are mixed-case, and the raw
 * form would produce uppercase characters that violate the
 * users_email_lowercase CHECK constraint (a real production bug the reclaim
 * test caught). Hex is deterministic (idempotency holds), injective (no
 * two ids collide), and always lowercase.
 */
export function tombstoneEmail(clerkUserId: string) {
  return `orphaned+${Buffer.from(clerkUserId).toString("hex")}@tombstone.invalid`;
}

export interface ResolvedIdentity {
  id: string;
  email: string; // already lowercased by callers
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

/**
 * Insert-or-reclaim a users row, race-safe under a per-email advisory lock.
 * The single write path for BOTH the JIT middleware and the Clerk webhook.
 *
 * The problem it solves: our PK is Clerk's user id, but `users.email` is
 * also UNIQUE. A recycled email (old Clerk account deleted, new account
 * signs up with the same address → new id, same email) collides on the
 * email constraint while onConflictDoNothing only guards the id — the old
 * code threw a raw 23505 and bricked the account on every request.
 *
 * Resolution = reclaim-as-NEW-identity, never match-by-email (matching
 * would let whoever controls an email today inherit the prior owner's
 * memberships/roles — an account-takeover vector). On an email conflict we
 * ask Clerk who owns the email now:
 *   - stored id NOT live in Clerk  → orphan → tombstone it, insert new row
 *   - stored id STILL live         → genuine conflict → readable CONFLICT
 * History stays keyed to the dead id; the new account starts clean.
 */
export async function provisionUserRow(params: {
  gateway: ClerkGateway;
  identity: ResolvedIdentity;
}): Promise<{ id: string }> {
  const { gateway, identity } = params;

  return txDb.transaction(async (tx) => {
    // Serialize everyone provisioning THIS email so a double webhook + JIT
    // can't both tombstone/insert concurrently.
    await lockKey(tx, "user-email", identity.email);

    // Idempotent upsert by id: if this Clerk id already has a row, refresh
    // its fields (and un-tombstone, in case this id was itself reclaimed
    // earlier). No email conflict possible — same id owns the same email.
    const [byId] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, identity.id))
      .limit(1);

    if (byId) {
      await tx
        .update(users)
        .set({
          email: identity.email,
          firstName: identity.firstName,
          lastName: identity.lastName,
          imageUrl: identity.imageUrl,
          deletedAt: null,
        })
        .where(eq(users.id, identity.id));
      return { id: identity.id };
    }

    // No row for this id. Is the email already taken by a DIFFERENT id?
    const [emailOwner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1);

    if (emailOwner) {
      const liveIds = await gateway.getUserIdsForEmail(identity.email);
      if (liveIds.includes(emailOwner.id)) {
        // The stored row's Clerk account is still live — the email genuinely
        // belongs to another active account. Refuse, readably.
        throw new TRPCError({
          code: "CONFLICT",
          message: "This email is already associated with an active account.",
        });
      }
      // Orphan (its Clerk account is gone): tombstone to free the email.
      await tombstoneOrphan(tx, emailOwner.id);
    }

    await tx.insert(users).values({
      id: identity.id,
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      imageUrl: identity.imageUrl,
    });
    return { id: identity.id };
  });
}

/**
 * Rename an orphan's email to its reserved tombstone address and soft-delete
 * it, freeing the real email's unique slot. Idempotent: the `ne` guard means
 * calling it on an already-tombstoned row matches zero rows — a no-op, never
 * a crash (the tombstone-already-tombstoned case the race test pins).
 */
export async function tombstoneOrphan(tx: Tx, clerkUserId: string) {
  const tombstone = tombstoneEmail(clerkUserId);
  await tx
    .update(users)
    .set({ email: tombstone, deletedAt: new Date() })
    .where(and(eq(users.id, clerkUserId), ne(users.email, tombstone)));
}

/**
 * The user.deleted webhook handler. Soft-deletes AND tombstones the email
 * in one step — the crucial fix over the old soft-delete-only version,
 * which left the email occupying its unique slot so a same-email re-signup
 * still collided even in production-with-webhooks. Idempotent (the ne guard
 * on an already-tombstoned row is a no-op). Runs on the http client — no
 * check-then-act, so no lock needed.
 */
export async function handleUserDeleted(clerkUserId: string) {
  const tombstone = tombstoneEmail(clerkUserId);
  await db
    .update(users)
    .set({ email: tombstone, deletedAt: new Date() })
    .where(and(eq(users.id, clerkUserId), ne(users.email, tombstone)));
}

/**
 * JIT path: resolve the identity from Clerk (we only have the id), then
 * provision. Returns null when Clerk has no email for the id (nothing we
 * can insert) — the caller decides how to surface that. A CONFLICT throw
 * propagates unchanged so requireAuth can relay its readable message.
 */
export async function provisionUserFromClerk(params: {
  gateway: ClerkGateway;
  clerkUserId: string;
}): Promise<{ id: string } | null> {
  const clerkUser = await params.gateway.getUser(params.clerkUserId);
  if (!clerkUser?.email) return null;

  return provisionUserRow({
    gateway: params.gateway,
    identity: {
      id: clerkUser.id,
      email: clerkUser.email.toLowerCase(),
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      imageUrl: clerkUser.imageUrl,
    },
  });
}

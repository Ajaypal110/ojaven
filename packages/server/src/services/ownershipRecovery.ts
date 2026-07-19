import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { agencies, db, notifications, teamMembers, users } from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import type { ClerkGateway } from "./clerkGateway";
import { activeOwners } from "./teamMembership";
import { lockAgency } from "./agencyLock";
import { sql } from "drizzle-orm";

export const OWNER_INACTIVITY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
export const RECOVERY_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Ownership recovery: the self-service path for "every owner is gone"
 * (account lost, left the company, can't log in), replacing manual DB
 * surgery as the primary answer.
 *
 * Shape (all decided in review, none of it incidental):
 * - Precondition: ALL active owners inactive 30+ days by Clerk's own
 *   lastSignInAt. One active owner anywhere = the agency isn't stranded =
 *   no recovery, and the error names that owner.
 * - 14-day grace period between request and completion.
 * - Completion is SELF-ONLY (the requesting admin), so nobody's click can
 *   hand someone else the agency. The objection path for a bad-faith
 *   request is getting any owner to sign in once — mechanical, ungriefable
 *   — not an admin-vs-admin cancel button.
 * - Any owner sign-in after the request (checked lazily at completion)
 *   invalidates it. Presence, not awareness: they don't have to read
 *   anything, just authenticate.
 * - Completion demotes owners to admin (graceful if they ever return) and
 *   promotes the requester.
 * - One pending request per agency. A request whose grace fully elapsed
 *   uncompleted can be superseded by a DIFFERENT admin (prevents deadlock
 *   if the requester themselves vanishes); the requester can cancel their
 *   own at any time.
 *
 * KNOWN GAP, deliberate: the notifications written here are an audit trail
 * ("someone tried this while you were away"), NOT a timely warning — an
 * owner can only see them by signing in, and signing in is precisely the
 * event that invalidates the request. Until real email exists (Resend,
 * later), there is NO proactive out-of-app warning to owners; the 30-day
 * precondition and 14-day grace ARE the safeguard.
 */


async function requireAdminActor(tx: Tx, agencyId: string, userId: string) {
  const [actor] = await tx
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.agencyId, agencyId),
        eq(teamMembers.userId, userId),
        isNull(teamMembers.deletedAt)
      )
    )
    .limit(1);

  if (!actor || actor.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only an admin can use ownership recovery.",
    });
  }
  return actor;
}

async function ownerDisplayName(tx: Tx, userId: string) {
  const [user] = await tx
    .select({ email: users.email, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return userId;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name ? `${name} (${user.email})` : user.email;
}

export async function requestOwnershipRecovery(params: {
  agencyId: string;
  actor: { userId: string };
  gateway: ClerkGateway;
  now?: number;
}) {
  const now = params.now ?? Date.now();

  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);
    await requireAdminActor(tx, params.agencyId, params.actor.userId);

    const [agency] = await tx
      .select({
        requestedAt: agencies.ownershipRecoveryRequestedAt,
        requestedById: agencies.ownershipRecoveryRequestedById,
      })
      .from(agencies)
      .where(eq(agencies.id, params.agencyId))
      .limit(1);
    if (!agency) throw new TRPCError({ code: "NOT_FOUND", message: "Agency not found." });

    if (agency.requestedAt) {
      if (agency.requestedById === params.actor.userId) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a pending request." });
      }
      const graceEnds = agency.requestedAt.getTime() + RECOVERY_GRACE_PERIOD_MS;
      if (now < graceEnds) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another recovery request is already in its grace period.",
        });
      }
      // Stale (grace elapsed, never completed — requester presumably gone):
      // a different admin may supersede. Falls through to the fresh checks.
    }

    const owners = await activeOwners(tx, params.agencyId);
    const lastSignIns = await params.gateway.getUserLastSignInAt(owners.map((o) => o.userId));

    for (const owner of owners) {
      const last = lastSignIns.get(owner.userId);
      // Absent from map (deleted Clerk account) or null (never signed in)
      // both count as inactive — no sign-in evidence.
      if (last != null && now - last < OWNER_INACTIVITY_THRESHOLD_MS) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Owner ${await ownerDisplayName(tx, owner.userId)} was active in the last 30 days — this agency isn't stranded.`,
        });
      }
    }

    const requestedAt = new Date(now);
    await tx
      .update(agencies)
      .set({
        ownershipRecoveryRequestedAt: requestedAt,
        ownershipRecoveryRequestedById: params.actor.userId,
      })
      .where(eq(agencies.id, params.agencyId));

    // Audit trail, not a warning — see the block comment up top.
    if (owners.length > 0) {
      await tx.insert(notifications).values(
        owners.map((owner) => ({
          agencyId: params.agencyId,
          userId: owner.userId,
          type: "system" as const,
          title: "Ownership recovery requested",
          body: "An admin has requested ownership recovery for this agency. Signing in (which you have just done, if you're reading this) invalidates the request.",
        }))
      );
    }

    return {
      requestedAt,
      graceEndsAt: new Date(now + RECOVERY_GRACE_PERIOD_MS),
    };
  });
}

export async function cancelOwnershipRecovery(params: {
  agencyId: string;
  actor: { userId: string };
}) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const [agency] = await tx
      .select({
        requestedAt: agencies.ownershipRecoveryRequestedAt,
        requestedById: agencies.ownershipRecoveryRequestedById,
      })
      .from(agencies)
      .where(eq(agencies.id, params.agencyId))
      .limit(1);
    if (!agency?.requestedAt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No pending recovery request." });
    }
    if (agency.requestedById !== params.actor.userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the requesting admin can cancel their own request.",
      });
    }

    await tx
      .update(agencies)
      .set({ ownershipRecoveryRequestedAt: null, ownershipRecoveryRequestedById: null })
      .where(eq(agencies.id, params.agencyId));

    return { cancelled: true };
  });
}

export async function completeOwnershipRecovery(params: {
  agencyId: string;
  actor: { userId: string };
  gateway: ClerkGateway;
  now?: number;
}) {
  const now = params.now ?? Date.now();

  // Populated inside the transaction when an owner's sign-in objects to
  // the request; acted on AFTER commit, because writing the invalidation
  // and then throwing inside the transaction would roll the write back —
  // a real bug the test suite caught on first run.
  let invalidation: { by: string; requestedAt: Date } | null = null;

  const outcome = await txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const [agency] = await tx
      .select({
        requestedAt: agencies.ownershipRecoveryRequestedAt,
        requestedById: agencies.ownershipRecoveryRequestedById,
      })
      .from(agencies)
      .where(eq(agencies.id, params.agencyId))
      .limit(1);
    if (!agency?.requestedAt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No pending recovery request." });
    }
    const requestedAt = agency.requestedAt; // capture the narrowing for use across awaits
    if (agency.requestedById !== params.actor.userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the admin who filed the request can complete it.",
      });
    }

    const actor = await requireAdminActor(tx, params.agencyId, params.actor.userId);

    const graceEnds = requestedAt.getTime() + RECOVERY_GRACE_PERIOD_MS;
    if (now < graceEnds) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `The grace period ends ${new Date(graceEnds).toISOString()}.`,
      });
    }

    // Re-fetch CURRENT owners — not the set from request time. Someone
    // promoted to co-owner during the grace period counts fully, and their
    // activity blocks completion like any other owner's.
    const owners = await activeOwners(tx, params.agencyId);
    const lastSignIns = await params.gateway.getUserLastSignInAt(owners.map((o) => o.userId));

    for (const owner of owners) {
      const last = lastSignIns.get(owner.userId);
      if (last != null && last > requestedAt.getTime()) {
        // Sign-in since the request = the owner's objection.
        invalidation = { by: await ownerDisplayName(tx, owner.userId), requestedAt };
        return null;
      }
    }

    for (const owner of owners) {
      await tx.update(teamMembers).set({ role: "admin" }).where(eq(teamMembers.id, owner.id));
    }
    const [newOwner] = await tx
      .update(teamMembers)
      .set({ role: "owner" })
      .where(eq(teamMembers.id, actor.id))
      .returning();

    await tx
      .update(agencies)
      .set({ ownershipRecoveryRequestedAt: null, ownershipRecoveryRequestedById: null })
      .where(eq(agencies.id, params.agencyId));

    // Audit trail for the demoted owners, should they ever return.
    if (owners.length > 0) {
      await tx.insert(notifications).values(
        owners.map((owner) => ({
          agencyId: params.agencyId,
          userId: owner.userId,
          type: "system" as const,
          title: "Ownership recovered by an admin",
          body: "After 30+ days of owner inactivity and a 14-day grace period, an admin completed ownership recovery. Your role is now admin.",
        }))
      );
    }

    return { newOwner, demotedOwnerIds: owners.map((o) => o.id) };
  });

  if (invalidation !== null) {
    const { by, requestedAt } = invalidation as { by: string; requestedAt: Date };
    // Conditional on requestedAt still matching what we checked, so a
    // request superseded in the tiny window since commit can't be clobbered.
    await db
      .update(agencies)
      .set({ ownershipRecoveryRequestedAt: null, ownershipRecoveryRequestedById: null })
      .where(
        and(
          eq(agencies.id, params.agencyId),
          eq(agencies.ownershipRecoveryRequestedAt, requestedAt)
        )
      );
    throw new TRPCError({
      code: "CONFLICT",
      message: `Owner ${by} signed in after the request was filed — the request has been invalidated.`,
    });
  }

  if (!outcome) {
    // Unreachable: outcome is only null when invalidation was set.
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Recovery completion failed." });
  }

  return outcome;
}
